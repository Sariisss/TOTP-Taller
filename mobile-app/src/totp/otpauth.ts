import { base32Decode } from '../crypto/encoding';

export interface ParsedOtpauth {
  issuer: string;
  label: string;
  secret: string;
}

const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));

/** otpauth://totp/UniSabana:estudiante@unisabana.edu.co?secret=XXXX&issuer=UniSabana */
export function parseOtpauthUri(uri: string): ParsedOtpauth {
  const prefix = 'otpauth://totp/';
  if (!uri.toLowerCase().startsWith(prefix)) throw new Error('No es un QR otpauth://totp válido');
  const rest = uri.slice(prefix.length);
  const q = rest.indexOf('?');
  const path = dec(q >= 0 ? rest.slice(0, q) : rest);
  const params: Record<string, string> = {};
  if (q >= 0) {
    rest.slice(q + 1).split('&').forEach((pair) => {
      const [k, v = ''] = pair.split('=');
      if (k) params[k.toLowerCase()] = dec(v);
    });
  }
  const secret = (params.secret ?? '').replace(/\s/g, '').toUpperCase();
  if (!secret) throw new Error('El QR no contiene "secret"');
  const algo = (params.algorithm ?? 'SHA1').toUpperCase();
  if (algo !== 'SHA1') throw new Error(`Algoritmo ${algo} no soportado (solo SHA1)`);
  if ((params.digits ?? '6') !== '6') throw new Error('Solo se soportan códigos de 6 dígitos');
  if ((params.period ?? '30') !== '30') throw new Error('Solo se soporta periodo de 30 s');

  const [maybeIssuer, ...restLabel] = path.split(':');
  const hasIssuerInPath = restLabel.length > 0;
  const issuer = params.issuer ?? (hasIssuerInPath ? maybeIssuer : '');
  const label = (hasIssuerInPath ? restLabel.join(':') : maybeIssuer).trim();
  return { issuer: issuer.trim(), label, secret };
}

/** Valida una semilla Base32 escrita o pegada a mano. Devuelve la semilla normalizada. */
export function validateSecret(raw: string): string {
  const secret = raw.replace(/[\s-]/g, '').toUpperCase();
  const bytes = base32Decode(secret); // lanza si hay caracteres inválidos
  if (bytes.length < 10) throw new Error('La semilla es demasiado corta (mínimo 16 caracteres Base32)');
  return secret;
}
