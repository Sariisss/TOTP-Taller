export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:8000').replace(/\/$/, '');
export const CLIENT_ID = 'unisabana-mobile';

// Claves válidas para SecureStore: alfanuméricos, ".", "-" y "_".
export const STORAGE_KEYS = {
  refreshToken: 'oauth.refresh_token',
  totpAccounts: 'totp.accounts',
} as const;
