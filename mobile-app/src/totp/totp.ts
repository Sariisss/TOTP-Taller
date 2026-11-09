import { base32Decode } from '../crypto/encoding';
import { hmacSha1 } from '../crypto/hmac';

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

/** T = floor(UnixTime / 30) */
export function counterFor(timeMs: number = Date.now(), period: number = TOTP_PERIOD): number {
  return Math.floor(timeMs / 1000 / period);
}

/** Entero de 64 bits Big-Endian (buffer de 8 bytes). */
export function counterToBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  return buf;
}

/** HMAC-SHA1 + Dynamic Truncation (RFC 4226 §5.3 / RFC 6238). */
export function totpFromBytes(secret: Uint8Array, counter: number): string {
  const h = hmacSha1(secret, counterToBytes(counter));
  const offset = h[19] & 0x0f;
  const binCode =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);
  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function totpFromBase32(secretBase32: string, counter: number): string {
  return totpFromBytes(base32Decode(secretBase32), counter);
}

/** Segundos que le quedan al código actual (30 -> 1). */
export function secondsRemaining(timeMs: number = Date.now(), period: number = TOTP_PERIOD): number {
  return period - (Math.floor(timeMs / 1000) % period);
}
