import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../config';

export interface TotpAccount {
  id: string;
  issuer: string;
  label: string;
  secret: string;
}

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Las semillas viven en Keychain/Keystore (cifrado por hardware), nunca en AsyncStorage. */
export async function loadAccounts(): Promise<TotpAccount[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.totpAccounts, OPTIONS);
    return raw ? (JSON.parse(raw) as TotpAccount[]) : [];
  } catch {
    return [];
  }
}

export async function saveAccounts(accounts: TotpAccount[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.totpAccounts, JSON.stringify(accounts), OPTIONS);
}

export function newAccountId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
