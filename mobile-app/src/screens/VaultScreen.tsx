import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SessionExpiredError, apiFetch, publicFetch } from '../api/http';
import { clearElevatedToken, getElevatedToken, setElevatedToken } from '../auth/tokenStore';
import { Button, Card, Muted, Title } from '../ui/components';
import { colors, mono } from '../ui/theme';

interface VaultData {
  titulo: string;
  usuario: string;
  secretos: { nombre: string; valor: string }[];
}
type Phase = 'loading' | 'locked' | 'open' | 'error';

export default function VaultScreen() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<VaultData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<string | null>(null);
  const lastVerified = useRef<{ stepUp: string; code: string } | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setMessage(null);
    try {
      let res: Response | null = null;
      const elevated = getElevatedToken();
      if (elevated) {
        res = await apiFetch('/api/boveda-critica', {}, { token: elevated });
        if (res.status === 401 || res.status === 403) {
          clearElevatedToken(); // expiró la sesión elevada (10 min)
          res = null;
        }
      }
      if (!res) res = await apiFetch('/api/boveda-critica'); // token estándar (mfa_verified=false)

      if (res.ok) {
        setData(await res.json());
        setPhase('open');
      } else if (res.status === 403) {
        const body = await res.json();
        if (body.error === 'mfa_required') {
          setStepUpToken(body.step_up_token); // atrapamos el 403 y abrimos el modal 2FA
          setPhase('locked');
          setCode('');
          setModalError(null);
          setModal(true);
        } else {
          throw new Error(body.message ?? 'Acceso denegado');
        }
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      if (e instanceof SessionExpiredError) return; // el AuthContext ya navega a Bienvenida
      setMessage((e as Error).message);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async () => {
    if (!stepUpToken || code.length !== 6) return;
    setBusy(true);
    setModalError(null);
    try {
      const res = await publicFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ step_up_token: stepUpToken, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setElevatedToken(body.elevated_token, body.expires_in);
        lastVerified.current = { stepUp: stepUpToken, code };
        setReplayResult(null);
        setModal(false);
        await load(); // la app vuelve a consultar GET /api/boveda-critica
      } else if (body.error === 'invalid_step_up') {
        setModal(false);
        await load(); // el step_up_token venció: pedimos uno nuevo
      } else {
        setModalError(res.status === 409 ? `409 Conflict: ${body.message}` : body.message ?? `HTTP ${res.status}`);
        setCode('');
      }
    } catch (e) {
      setModalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Prueba de aceptación #5: reenviar inmediatamente el mismo código recién usado. */
  const testReplay = async () => {
    const last = lastVerified.current;
    if (!last) return;
    setBusy(true);
    try {
      const res = await publicFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ step_up_token: last.stepUp, code: last.code }),
      });
      const body = await res.json().catch(() => ({}));
      setReplayResult(`HTTP ${res.status} → ${body.message ?? JSON.stringify(body)}`);
    } catch (e) {
      setReplayResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const relock = () => {
    clearElevatedToken();
    lastVerified.current = null;
    setData(null);
    void load();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Title>Bóveda Crítica</Title>

      {phase === 'loading' && <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />}

      {phase === 'locked' && (
        <Card style={{ gap: 12 }}>
          <Text style={styles.lock}>🔒</Text>
          <Muted>Este recurso exige un segundo factor. Obtén el código en la pestaña Authenticator.</Muted>
          <Button title="Ingresar código 2FA" onPress={() => { setCode(''); setModalError(null); setModal(true); }} />
        </Card>
      )}

      {phase === 'error' && (
        <Card style={{ gap: 12 }}>
          <Text style={{ color: colors.danger }}>{message}</Text>
          <Button title="Reintentar" onPress={() => void load()} />
        </Card>
      )}

      {phase === 'open' && data && (
        <>
          <Card style={{ borderColor: colors.success, borderWidth: 1.5, gap: 10 }}>
            <Text style={{ color: colors.success, fontWeight: '700' }}>🔓 Acceso autorizado (mfa_verified: true)</Text>
            {data.secretos.map((s) => (
              <View key={s.nombre}>
                <Muted>{s.nombre}</Muted>
                <Text style={styles.secret}>{s.valor}</Text>
              </View>
            ))}
          </Card>
          <Button title="Probar Anti-Replay (reenviar el mismo código)" variant="ghost" onPress={testReplay} loading={busy} />
          {replayResult ? <Text style={styles.replay}>{replayResult}</Text> : null}
          <Button title="Bloquear bóveda" variant="danger" onPress={relock} />
        </>
      )}

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Verificación en dos pasos</Text>
            <Muted>Ingresa el código de 6 dígitos de tu Authenticator.</Muted>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={colors.muted}
              autoFocus
              textContentType="oneTimeCode"
            />
            {modalError ? <Text style={{ color: colors.danger }}>{modalError}</Text> : null}
            <Button title="Verificar" onPress={verify} loading={busy} disabled={code.length !== 6} />
            <Button title="Cancelar" variant="ghost" onPress={() => setModal(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  lock: { fontSize: 44, textAlign: 'center' },
  secret: { color: colors.text, fontFamily: mono, fontSize: 16, fontWeight: '700' },
  replay: { color: colors.warning, fontFamily: mono, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(22,32,29,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.card, borderRadius: 28, padding: 24, gap: 14 },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  codeInput: {
    backgroundColor: colors.bg, color: colors.primary, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border,
    fontFamily: mono, fontSize: 36, fontWeight: '800', textAlign: 'center', letterSpacing: 8, paddingVertical: 14,
  },
});
