import { API_BASE_URL } from '../config';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from '../auth/tokenStore';

export class SessionExpiredError extends Error {
  constructor() {
    super('La sesión expiró. Inicia sesión de nuevo.');
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }
}

// ---------------- Cola de renovación silenciosa (Silent Refresh Queue) ----------------
interface Pending {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}
let isRefreshing = false;
let queue: Pending[] = [];
let refreshCount = 0;
let onSessionExpired: (() => void) | null = null;

export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};
/** Cuántas renovaciones reales (POST /auth/refresh) se han hecho: sirve para demostrar la cola. */
export const getRefreshCount = () => refreshCount;

const jsonHeaders = (token?: string | null): Record<string, string> => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function performRefresh(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new SessionExpiredError();

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // refresh_token vencido o revocado -> limpiar enclave seguro y mandar al login
    await clearSession();
    onSessionExpired?.();
    throw new SessionExpiredError();
  }
  if (!res.ok) throw new Error(`No se pudo renovar la sesión (HTTP ${res.status})`);

  const data = await res.json();
  setAccessToken(data.access_token);
  if (data.refresh_token) await saveRefreshToken(data.refresh_token); // rotación
  refreshCount += 1;
  return data.access_token as string;
}

function flush(error: unknown, token: string | null) {
  const pending = queue;
  queue = [];
  isRefreshing = false;
  pending.forEach((p) => (error ? p.reject(error) : p.resolve(token as string)));
}

/** Encola al llamador; solo el PRIMERO dispara la petición real de renovación. */
export function refreshAccessToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    queue.push({ resolve, reject });
    if (isRefreshing) return;
    isRefreshing = true;
    performRefresh().then(
      (token) => flush(null, token),
      (err) => flush(err ?? new Error('refresh falló'), null),
    );
  });
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...jsonHeaders(token), ...((init.headers as Record<string, string>) ?? {}) },
  });
}

/** Petición SIN autenticación ni lógica de refresh (p. ej. /auth/mfa/verify). */
export const publicFetch = (path: string, init: RequestInit = {}) => send(path, init, null);

/**
 * Cliente con interceptor:
 *  - si hay una renovación en curso, la petición espera en cola;
 *  - ante 401 pausa, renueva UNA sola vez, reintenta y desbloquea la cola;
 *  - si se pasa `token` explícito, se usa tal cual (sin lógica de refresh).
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: { token?: string } = {},
): Promise<Response> {
  if (opts.token) return send(path, init, opts.token);

  if (isRefreshing) await refreshAccessToken(); // pausa: se une a la cola

  const tokenUsed = getAccessToken();
  const res = await send(path, init, tokenUsed);
  if (res.status !== 401) return res;

  // Otro request ya renovó mientras éste volaba -> basta con reintentar con el token nuevo
  const current = getAccessToken();
  const fresh = current && current !== tokenUsed ? current : await refreshAccessToken();
  return send(path, init, fresh);
}

export async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
