import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE_URL, CLIENT_ID } from '../config';
import { generateCodeChallenge, generateCodeVerifier, generateState } from '../crypto/pkce';
import { publicFetch } from '../api/http';
import { saveRefreshToken, setAccessToken } from './tokenStore';

export class OAuthCancelledError extends Error {
  constructor() {
    super('Inicio de sesión cancelado');
    this.name = 'OAuthCancelledError';
  }
}

const qs = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

const asString = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v));

/**
 * Deep link de retorno.
 * En Expo Go se arma con la dirección de Metro: exp://192.168.1.9:8081/--/oauth/callback
 * (no depende de ningún `scheme` en app.json). En un build propio usa el scheme de la app.
 */
function buildRedirectUri(): string {
  const hostUri = Constants.expoConfig?.hostUri; // ej. "192.168.1.9:8081"
  if (hostUri) return `exp://${hostUri}/--/oauth/callback`;
  return Linking.createURL('oauth/callback', { scheme: 'unisabana-auth' });
}

/**
 * Flujo Authorization Code + PKCE (RFC 7636) usando el NAVEGADOR DEL SISTEMA
 * (ASWebAuthenticationSession en iOS / Custom Tabs en Android). Nunca una WebView embebida.
 */
export async function signInWithBrowser(): Promise<void> {
  // 1) Material criptográfico (solo en memoria local de esta función)
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 2) Deep link de retorno
  const redirectUri = buildRedirectUri();

  const authorizeUrl =
    `${API_BASE_URL}/oauth/authorize?` +
    qs({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

  // 3) Navegador seguro del sistema
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
  if (result.type !== 'success') throw new OAuthCancelledError();

  // 4) Validar el callback (anti-CSRF)
  const params = Linking.parse(result.url).queryParams ?? {};
  const error = asString(params.error);
  if (error) throw new Error(`El proveedor devolvió un error: ${error}`);
  if (asString(params.state) !== state) {
    throw new Error('El parámetro state no coincide: posible ataque CSRF. Intercambio abortado.');
  }
  const code = asString(params.code);
  if (!code) throw new Error('El callback no trae authorization_code');

  // 5) Token Exchange: code + code_verifier (el backend verifica SHA256(verifier) === challenge)
  const res = await publicFetch('/auth/oauth/token', {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Fallo en el intercambio de token (HTTP ${res.status})`);

  setAccessToken(body.access_token); // RAM
  await saveRefreshToken(body.refresh_token); // Keychain / Keystore
}