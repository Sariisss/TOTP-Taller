import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { apiFetch, apiJson, getRefreshCount } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { setAccessToken } from '../auth/tokenStore';
import { Button, Card, Muted, Title } from '../ui/components';
import { colors, mono } from '../ui/theme';

interface Perfil {
  usuario: string;
  mfa_verified: boolean;
  token_expira_en_s: number;
}

export default function SessionScreen() {
  const { signOut } = useAuth();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadPerfil = useCallback(async () => {
    try {
      setPerfil(await apiJson<Perfil>('/api/perfil'));
    } catch (e) {
      setLog((l) => [`Error perfil: ${(e as Error).message}`, ...l]);
    }
  }, []);

  useEffect(() => {
    void loadPerfil();
  }, [loadPerfil]);

  /** Demuestra la Silent Refresh Queue: 3 peticiones concurrentes con token vencido -> 1 sola renovación. */
  const simulateExpiry = async () => {
    setBusy(true);
    const before = getRefreshCount();
    setAccessToken('token.vencido.simulado'); // corrompe el access_token en RAM => el backend responde 401
    setLog((l) => ['▶ access_token invalidado. Lanzando 3 peticiones en paralelo…', ...l]);
    try {
      const results = await Promise.all([1, 2, 3].map((i) => apiFetch('/api/perfil').then((r) => `#${i} → HTTP ${r.status}`)));
      const renewals = getRefreshCount() - before;
      setLog((l) => [`✔ ${results.join(' · ')} · renovaciones reales: ${renewals} (esperado: 1)`, ...l]);
    } catch (e) {
      setLog((l) => [`✖ ${(e as Error).message}`, ...l]);
    } finally {
      setBusy(false);
      void loadPerfil();
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Title>Sesión</Title>
      <Card style={{ gap: 6 }}>
        <Muted style={styles.eyebrow}>Usuario</Muted>
        <Text style={styles.value}>{perfil?.usuario ?? '…'}</Text>
        <Muted style={styles.eyebrow}>Token actual expira en</Muted>
        <Text style={styles.value}>{perfil ? `${perfil.token_expira_en_s} s` : '…'}</Text>
        <Muted style={styles.eyebrow}>mfa_verified</Muted>
        <Text style={styles.value}>{perfil ? String(perfil.mfa_verified) : '…'}</Text>
        <Button title="Actualizar" variant="ghost" onPress={() => void loadPerfil()} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Muted>
          Tip: levanta el backend con ACCESS_TTL_SECONDS=20 para ver expirar el token de forma natural, o usa este botón.
        </Muted>
        <Button title="Simular token expirado (3 llamadas)" onPress={simulateExpiry} loading={busy} />
      </Card>

      {log.length > 0 && (
        <Card style={styles.logCard}>
          {log.map((line, i) => (
            <Text key={i} style={styles.log}>{line}</Text>
          ))}
        </Card>
      )}

      <Button title="Cerrar sesión" variant="danger" onPress={() => void signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  eyebrow: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 6 },
  value: { color: colors.text, fontSize: 20, fontFamily: mono, fontWeight: '700' },
  logCard: { gap: 8, backgroundColor: colors.ink, borderColor: colors.ink },
  log: { color: colors.primarySoft, fontFamily: mono, fontSize: 12, lineHeight: 18 },
});
