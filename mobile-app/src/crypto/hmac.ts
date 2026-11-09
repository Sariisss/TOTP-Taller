import { sha1 } from './sha1';

const BLOCK = 64; // tamaño de bloque de SHA-1

/** HMAC-SHA1 (RFC 2104): H((K^opad) || H((K^ipad) || msg)). */
export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? sha1(key) : key);
  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 20);
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(message, BLOCK);
  outer.set(sha1(inner), BLOCK);
  return sha1(outer);
}
