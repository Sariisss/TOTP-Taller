import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../config';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ---- access_token: SOLO en memoria volátil (se pierde al matar el proceso) ----
let accessToken: string | null = null;
export const getAccessToken = (): string | null => accessToken;
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

// ---- elevated_token (step-up, mfa_verified=true): también solo en memoria ----
let elevated: { token: string; expiresAt: number } | null = null;
export function setElevatedToken(token: string, expiresInSeconds: number): void {
  elevated = { token, expiresAt: Date.now() + expiresInSeconds * 1000 - 5000 };
}
export function getElevatedToken(): string | null {
  if (!elevated) return null;
  if (Date.now() >= elevated.expiresAt) {
    elevated = null;
    return null;
  }
  return elevated.token;
}
export const clearElevatedToken = (): void => {
  elevated = null;
};

// ---- refresh_token: Keychain (iOS) / Keystore (Android) vía expo-secure-store ----
export const saveRefreshToken = (token: string) =>
  SecureStore.setItemAsync(STORAGE_KEYS.refreshToken, token, OPTIONS);
export const getRefreshToken = () => SecureStore.getItemAsync(STORAGE_KEYS.refreshToken, OPTIONS);

export async function clearSession(): Promise<void> {
  accessToken = null;
  elevated = null;
  await SecureStore.deleteItemAsync(STORAGE_KEYS.refreshToken, OPTIONS);
}
