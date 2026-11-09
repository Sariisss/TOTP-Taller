"""
Utilidades de seguridad SIN dependencias externas:
  - Tokens firmados HS256 (formato JWT) implementados a mano.
  - TOTP (RFC 6238) para validar el segundo factor en el servidor.
  - PKCE (RFC 7636): verificación S256.
"""
import base64
import hashlib
import hmac
import json
import re
import secrets
import struct
import time
from typing import Any, Optional

# ---------------------------------------------------------------- Base64URL

def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------------------------------------------------------------- Tokens HS256

class TokenError(Exception):
    pass


def sign_token(claims: dict[str, Any], secret: str, ttl_seconds: int) -> str:
    now = int(time.time())
    payload = {**claims, "iat": now, "exp": now + ttl_seconds, "jti": secrets.token_hex(8)}
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = (
        b64url_encode(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    )
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + b64url_encode(sig)


def verify_token(token: str, secret: str, expected_typ: Optional[str] = None) -> dict[str, Any]:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}"
        expected = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, b64url_decode(sig_b64)):
            raise TokenError("firma inválida")
        header = json.loads(b64url_decode(header_b64))
        if header.get("alg") != "HS256":
            raise TokenError("algoritmo no permitido")
        payload = json.loads(b64url_decode(payload_b64))
    except TokenError:
        raise
    except Exception as exc:  # token mal formado
        raise TokenError("token mal formado") from exc

    if int(payload.get("exp", 0)) < int(time.time()):
        raise TokenError("token expirado")
    if expected_typ and payload.get("typ") != expected_typ:
        raise TokenError("tipo de token incorrecto")
    return payload


# ---------------------------------------------------------------- PKCE

_VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


def valid_code_verifier(verifier: str) -> bool:
    return bool(_VERIFIER_RE.match(verifier or ""))


def s256_challenge(verifier: str) -> str:
    return b64url_encode(hashlib.sha256(verifier.encode("ascii")).digest())


def pkce_matches(verifier: str, challenge: str) -> bool:
    if not valid_code_verifier(verifier):
        return False
    return hmac.compare_digest(s256_challenge(verifier), challenge)


# ---------------------------------------------------------------- TOTP (RFC 6238)

TOTP_PERIOD = 30
TOTP_DIGITS = 6


def base32_decode(secret: str) -> bytes:
    clean = secret.replace(" ", "").replace("-", "").upper()
    return base64.b32decode(clean + "=" * (-len(clean) % 8))


def totp_at_counter(secret_b32: str, counter: int) -> str:
    key = base32_decode(secret_b32)
    msg = struct.pack(">Q", counter)                 # 8 bytes big-endian
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F                       # dynamic truncation
    bin_code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(bin_code % (10 ** TOTP_DIGITS)).zfill(TOTP_DIGITS)


def totp_now(secret_b32: str, at: Optional[float] = None) -> str:
    t = int((time.time() if at is None else at) // TOTP_PERIOD)
    return totp_at_counter(secret_b32, t)


def matching_window(secret_b32: str, code: str, at: Optional[float] = None) -> Optional[int]:
    """Devuelve -1, 0 ó +1 si el código coincide con C-1, C o C+1; None si no coincide."""
    counter = int((time.time() if at is None else at) // TOTP_PERIOD)
    for delta in (-1, 0, 1):
        if hmac.compare_digest(totp_at_counter(secret_b32, counter + delta), code):
            return delta
    return None
