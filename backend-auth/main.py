"""
Backend de apoyo — Taller Seguridad Móvil (OAuth 2.0 + PKCE, Silent Refresh, Step-Up 2FA).
Proveedor de identidad + API protegida en un solo servicio, con almacenamiento EN MEMORIA.

Ejecutar:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import hmac
import html
import json
import os
import re
import secrets
import threading
import time
from typing import Any, Optional
from urllib.parse import quote, urlencode

from fastapi import FastAPI, Form, Header, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import security as sec

# ------------------------------------------------------------------ Configuración

def env_int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-cambia-este-secreto-en-produccion")
ACCESS_TTL = env_int("ACCESS_TTL_SECONDS", 300)          # 5 min
REFRESH_TTL = env_int("REFRESH_TTL_SECONDS", 30 * 24 * 3600)  # 30 días
ELEVATED_TTL = env_int("ELEVATED_TTL_SECONDS", 600)      # 10 min
STEP_UP_TTL = env_int("STEP_UP_TTL_SECONDS", 300)        # 5 min
AUTH_CODE_TTL = 120
REPLAY_TTL = 90

DEMO_USER = os.getenv("DEMO_USER", "estudiante")
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "unisabana123")
TOTP_SECRET = os.getenv("TOTP_SECRET", "JBSWY3DPEHPK3PXP")
ISSUER = os.getenv("TOTP_ISSUER", "UniSabana")
CLIENT_ID = "unisabana-mobile"
ALLOWED_REDIRECT_PREFIXES = tuple(
    p.strip() for p in os.getenv("ALLOWED_REDIRECT_PREFIXES", "exp://,exps://,unisabana-auth://").split(",")
)

# ------------------------------------------------------------------ Estado en memoria

LOCK = threading.Lock()
AUTH_CODES: dict[str, dict[str, Any]] = {}
REFRESH_TOKENS: dict[str, dict[str, Any]] = {}
USED_TOTP: dict[tuple[str, str], float] = {}   # (usuario, código) -> expira

app = FastAPI(title="Backend Auth — Taller Seguridad Móvil")


class ApiError(Exception):
    def __init__(self, status: int, error: str, message: str = "", **extra: Any):
        self.status, self.body = status, {"error": error, "message": message, **extra}


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=exc.body)


# ------------------------------------------------------------------ Utilidades

def redirect_allowed(uri: str) -> bool:
    return uri.startswith(ALLOWED_REDIRECT_PREFIXES)


def issue_access(user: str, mfa: bool = False, ttl: Optional[int] = None) -> str:
    return sec.sign_token(
        {"sub": user, "typ": "access", "mfa_verified": mfa}, JWT_SECRET, ttl or ACCESS_TTL
    )


def issue_refresh(user: str) -> str:
    token = secrets.token_urlsafe(48)
    with LOCK:
        REFRESH_TOKENS[token] = {"user": user, "exp": time.time() + REFRESH_TTL}
    return token


def current_claims(authorization: Optional[str]) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "missing_token", "Falta el header Authorization: Bearer")
    try:
        return sec.verify_token(authorization[7:].strip(), JWT_SECRET, "access")
    except sec.TokenError as exc:
        raise ApiError(401, "invalid_token", str(exc))


def purge_expired() -> None:
    now = time.time()
    for store in (AUTH_CODES, REFRESH_TOKENS):
        for k in [k for k, v in store.items() if v["exp"] < now]:
            store.pop(k, None)
    for k in [k for k, exp in USED_TOTP.items() if exp < now]:
        USED_TOTP.pop(k, None)


# ------------------------------------------------------------------ Fase 1: OAuth 2.0 + PKCE

LOGIN_PAGE = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Iniciar sesión</title>
<style>
body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0}}
form{{background:#1e293b;padding:28px;border-radius:16px;width:min(360px,90vw)}}
h1{{font-size:20px;margin:0 0 4px}}p{{color:#94a3b8;font-size:13px;margin:0 0 18px}}
input{{width:100%;box-sizing:border-box;padding:12px;margin-bottom:12px;border-radius:10px;border:1px solid #334155;
background:#0f172a;color:#fff;font-size:16px}}
button{{width:100%;padding:13px;border:0;border-radius:10px;background:#6366f1;color:#fff;font-size:16px;font-weight:600}}
.err{{color:#fca5a5;font-size:13px;margin-bottom:10px}}</style></head><body>
<form method="post" action="/oauth/authorize">
<h1>Universidad de La Sabana</h1><p>Proveedor de identidad (laboratorio). Cliente: {client_id}</p>
{error}
{hidden}
<input name="username" placeholder="Usuario" autocapitalize="none" autocomplete="username" required>
<input name="password" type="password" placeholder="Contraseña" autocomplete="current-password" required>
<button type="submit">Iniciar sesión</button></form></body></html>"""

REDIRECT_PAGE = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Volviendo a la app…</title></head>
<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;text-align:center;padding-top:30vh">
<p>Autenticación correcta. Volviendo a la app…</p>
<p><a style="color:#a5b4fc;font-size:18px" href="{url}">Toca aquí si no regresa automáticamente</a></p>
<script>setTimeout(function(){{window.location.href={url_js};}},50);</script></body></html>"""

OAUTH_FIELDS = ("client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type")


def render_login(params: dict[str, str], error: str = "") -> HTMLResponse:
    hidden = "".join(
        f'<input type="hidden" name="{k}" value="{html.escape(params.get(k, ""), quote=True)}">'
        for k in OAUTH_FIELDS
    )
    err = f'<div class="err">{html.escape(error)}</div>' if error else ""
    return HTMLResponse(LOGIN_PAGE.format(client_id=html.escape(params.get("client_id", "")), hidden=hidden, error=err))


def validate_authorize_params(p: dict[str, str]) -> None:
    if p.get("response_type") != "code":
        raise ApiError(400, "unsupported_response_type", "Solo se soporta response_type=code")
    if p.get("client_id") != CLIENT_ID:
        raise ApiError(400, "invalid_client", "client_id desconocido")
    if not redirect_allowed(p.get("redirect_uri", "")):
        raise ApiError(400, "invalid_redirect_uri", f"redirect_uri debe empezar por {ALLOWED_REDIRECT_PREFIXES}")
    if p.get("code_challenge_method") != "S256":
        raise ApiError(400, "invalid_request", "PKCE obligatorio: code_challenge_method=S256")
    if not re.fullmatch(r"[A-Za-z0-9\-_]{43}", p.get("code_challenge", "")):
        raise ApiError(400, "invalid_request", "code_challenge inválido (SHA-256 en Base64URL sin relleno)")
    if len(p.get("state", "")) < 8:
        raise ApiError(400, "invalid_request", "state obligatorio (mínimo 8 caracteres)")


@app.get("/oauth/authorize", response_class=HTMLResponse)
def authorize_get(
    response_type: str = Query(""), client_id: str = Query(""), redirect_uri: str = Query(""),
    state: str = Query(""), code_challenge: str = Query(""), code_challenge_method: str = Query(""),
):
    params = dict(response_type=response_type, client_id=client_id, redirect_uri=redirect_uri,
                  state=state, code_challenge=code_challenge, code_challenge_method=code_challenge_method)
    validate_authorize_params(params)
    return render_login(params)


@app.post("/oauth/authorize", response_class=HTMLResponse)
def authorize_post(
    username: str = Form(""), password: str = Form(""),
    response_type: str = Form(""), client_id: str = Form(""), redirect_uri: str = Form(""),
    state: str = Form(""), code_challenge: str = Form(""), code_challenge_method: str = Form(""),
):
    params = dict(response_type=response_type, client_id=client_id, redirect_uri=redirect_uri,
                  state=state, code_challenge=code_challenge, code_challenge_method=code_challenge_method)
    validate_authorize_params(params)

    user_ok = hmac.compare_digest(username.encode(), DEMO_USER.encode())
    pass_ok = hmac.compare_digest(password.encode(), DEMO_PASSWORD.encode())
    if not (user_ok and pass_ok):
        return render_login(params, "Usuario o contraseña incorrectos")

    code = secrets.token_urlsafe(32)
    with LOCK:
        purge_expired()
        AUTH_CODES[code] = {
            "user": username, "challenge": code_challenge, "redirect_uri": redirect_uri,
            "client_id": client_id, "exp": time.time() + AUTH_CODE_TTL,
        }
    sep = "&" if "?" in redirect_uri else "?"
    target = f"{redirect_uri}{sep}{urlencode({'code': code, 'state': state})}"
    return HTMLResponse(REDIRECT_PAGE.format(url=html.escape(target, quote=True), url_js=json.dumps(target)))


class TokenRequest(BaseModel):
    grant_type: str = "authorization_code"
    code: str
    code_verifier: str
    redirect_uri: str
    client_id: str


@app.post("/auth/oauth/token")
def token_exchange(body: TokenRequest):
    with LOCK:
        purge_expired()
        entry = AUTH_CODES.pop(body.code, None)      # un solo uso
    if not entry:
        raise ApiError(400, "invalid_grant", "Código inválido, usado o expirado")
    if entry["client_id"] != body.client_id or entry["redirect_uri"] != body.redirect_uri:
        raise ApiError(400, "invalid_grant", "client_id o redirect_uri no coinciden")
    if not sec.pkce_matches(body.code_verifier, entry["challenge"]):
        raise ApiError(400, "invalid_grant", "PKCE: SHA256(code_verifier) no coincide con code_challenge")

    return {
        "token_type": "Bearer",
        "access_token": issue_access(entry["user"]),
        "expires_in": ACCESS_TTL,
        "refresh_token": issue_refresh(entry["user"]),
        "refresh_expires_in": REFRESH_TTL,
    }


# ------------------------------------------------------------------ Fase 2: Refresh / Logout

class RefreshRequest(BaseModel):
    refresh_token: str


@app.post("/auth/refresh")
def refresh(body: RefreshRequest):
    with LOCK:
        purge_expired()
        entry = REFRESH_TOKENS.pop(body.refresh_token, None)   # rotación: el viejo muere
    if not entry:
        raise ApiError(401, "invalid_grant", "refresh_token vencido o revocado")
    return {
        "token_type": "Bearer",
        "access_token": issue_access(entry["user"]),
        "expires_in": ACCESS_TTL,
        "refresh_token": issue_refresh(entry["user"]),
        "refresh_expires_in": REFRESH_TTL,
    }


@app.post("/auth/logout")
def logout(body: RefreshRequest):
    with LOCK:
        REFRESH_TOKENS.pop(body.refresh_token, None)
    return {"ok": True}


# ------------------------------------------------------------------ Fase 3: Step-Up + Anti-Replay

class MfaVerifyRequest(BaseModel):
    step_up_token: str
    code: str


@app.post("/auth/mfa/verify")
def mfa_verify(body: MfaVerifyRequest):
    try:
        claims = sec.verify_token(body.step_up_token, JWT_SECRET, "step_up")
    except sec.TokenError as exc:
        raise ApiError(401, "invalid_step_up", f"step_up_token inválido: {exc}")
    user = claims["sub"]

    code = body.code.strip()
    if not re.fullmatch(r"\d{6}", code):
        raise ApiError(400, "invalid_code", "El código debe tener 6 dígitos")

    with LOCK:                                   # check-and-set atómico
        purge_expired()
        if sec.matching_window(TOTP_SECRET, code) is None:
            raise ApiError(400, "invalid_code", "Código TOTP incorrecto o vencido")
        if (user, code) in USED_TOTP:
            raise ApiError(409, "replay_detected", "Replay Attack Detected")
        USED_TOTP[(user, code)] = time.time() + REPLAY_TTL

    return {
        "token_type": "Bearer",
        "elevated_token": issue_access(user, mfa=True, ttl=ELEVATED_TTL),
        "expires_in": ELEVATED_TTL,
    }


# ------------------------------------------------------------------ API protegida

@app.get("/api/perfil")
def perfil(authorization: Optional[str] = Header(default=None)):
    claims = current_claims(authorization)
    return {"usuario": claims["sub"], "mfa_verified": claims.get("mfa_verified", False),
            "token_expira_en_s": int(claims["exp"] - time.time())}


@app.get("/api/boveda-critica")
@app.get("/api/boveda")
def boveda(authorization: Optional[str] = Header(default=None)):
    claims = current_claims(authorization)
    if not claims.get("mfa_verified"):
        step_up = sec.sign_token({"sub": claims["sub"], "typ": "step_up"}, JWT_SECRET, STEP_UP_TTL)
        raise ApiError(403, "mfa_required", "Se requiere segundo factor (TOTP)", step_up_token=step_up)
    return {
        "titulo": "Bóveda Crítica",
        "usuario": claims["sub"],
        "secretos": [
            {"nombre": "Llave de API de producción", "valor": "sk_live_51N0t4R34l"},
            {"nombre": "Código de recuperación", "valor": "7F2K-9QXA-33LM"},
            {"nombre": "Nota confidencial", "valor": "Las notas de la sustentación son 5.0 :)"},
        ],
    }


# ------------------------------------------------------------------ Utilidades de laboratorio

def otpauth_uri() -> str:
    label = quote(f"{ISSUER}:{DEMO_USER}@unisabana.edu.co")
    return f"otpauth://totp/{label}?secret={TOTP_SECRET}&issuer={quote(ISSUER)}"


@app.get("/mfa/setup", response_class=HTMLResponse)
def mfa_setup():
    uri = otpauth_uri()
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><title>Semilla TOTP</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script></head>
<body style="font-family:system-ui;text-align:center;padding:30px">
<h2>Escanea con tu app Authenticator y con Google Authenticator</h2>
<div id="qr" style="display:inline-block"></div>
<p>Semilla Base32 (para pegar manualmente): <b style="font-size:20px">{html.escape(TOTP_SECRET)}</b></p>
<p style="word-break:break-all;color:#555">{html.escape(uri)}</p>
<script>new QRCode(document.getElementById("qr"),{{text:{json.dumps(uri)},width:260,height:260}});</script>
</body></html>""")


@app.get("/health")
def health():
    return {"ok": True, "access_ttl": ACCESS_TTL, "elevated_ttl": ELEVATED_TTL}


@app.on_event("startup")
def banner() -> None:
    print("\n" + "=" * 70)
    print(" Backend listo.  Usuario:", DEMO_USER, "| Contraseña:", DEMO_PASSWORD)
    print(" Semilla TOTP (Base32):", TOTP_SECRET)
    print(" otpauth URI:", otpauth_uri())
    print(" QR en el navegador del PC:  http://localhost:8000/mfa/setup")
    print(f" TTL access={ACCESS_TTL}s  refresh={REFRESH_TTL}s  elevated={ELEVATED_TTL}s")
    print("=" * 70 + "\n")
