import * as Crypto from 'expo-crypto';
import { base64ToBase64Url, bytesToBase64Url } from './encoding';

/** code_verifier: 32 bytes aleatorios -> 43 caracteres URL-safe (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  return bytesToBase64Url(Crypto.getRandomBytes(32));
}

/** code_challenge = BASE64URL(SHA256(code_verifier)), sin relleno (RFC 7636 §4.2). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64ToBase64Url(b64);
}

/** state anti-CSRF: 16 bytes aleatorios, único por solicitud. */
export function generateState(): string {
  return bytesToBase64Url(Crypto.getRandomBytes(16));
}
