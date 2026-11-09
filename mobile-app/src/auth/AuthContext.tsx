import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { publicFetch, refreshAccessToken, setSessionExpiredHandler } from '../api/http';
import { signInWithBrowser } from './oauth';
import { clearSession, getRefreshToken } from './tokenStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  bootMessage: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [bootMessage, setBootMessage] = useState<string | null>(null);

  useEffect(() => {
    // Si el refresh_token muere en cualquier momento -> volver a bienvenida/login automáticamente
    setSessionExpiredHandler(() => {
      setBootMessage('Tu sesión expiró. Inicia sesión de nuevo.');
      setStatus('signedOut');
    });
    (async () => {
      const refreshToken = await getRefreshToken().catch(() => null);
      if (!refreshToken) return setStatus('signedOut');
      try {
        await refreshAccessToken(); // restaura la sesión: el access_token nunca se persistió
        setStatus('signedIn');
      } catch {
        setBootMessage('No se pudo restaurar la sesión (¿backend apagado o sin red?).');
        setStatus('signedOut');
      }
    })();
    return () => setSessionExpiredHandler(null);
  }, []);

  const signIn = useCallback(async () => {
    setBootMessage(null);
    await signInWithBrowser();
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = await getRefreshToken().catch(() => null);
    if (refreshToken) {
      publicFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }).catch(
        () => undefined,
      );
    }
    await clearSession();
    setBootMessage(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(() => ({ status, bootMessage, signIn, signOut }), [status, bootMessage, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
