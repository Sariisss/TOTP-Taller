import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { TOTP_PERIOD, counterFor, totpFromBase32 } from '../totp/totp';
import { parseOtpauthUri, validateSecret } from '../totp/otpauth';
import { TotpAccount, loadAccounts, newAccountId, saveAccounts } from '../totp/accounts';
import { Button, Card, Muted, Title } from '../ui/components';
import { colors, mono } from '../ui/theme';

function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export default function AuthenticatorScreen({ onBack }: { onBack?: () => void }) {
  const [accounts, setAccounts] = useState<TotpAccount[]>([]);
  const [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadAccounts().then(setAccounts);
  }, []);

  // Reloj local: cero red. Funciona en Modo Avión.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const counter = counterFor(now);
  const elapsed = (now / 1000) % TOTP_PERIOD;
  const remaining = TOTP_PERIOD - elapsed;
  const fraction = remaining / TOTP_PERIOD;
  const urgent = remaining <= 5;

  // Los códigos solo se recalculan cuando cambia la ventana T (no en cada tick) -> sin parpadeos.
  const codes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const acc of accounts) {
      try {
        map[acc.id] = totpFromBase32(acc.secret, counter);
      } catch {
        map[acc.id] = '------';
      }
    }
    return map;
  }, [accounts, counter]);

  const addAccount = useCallback(
    async (data: { issuer: string; label: string; secret: string }) => {
      if (accounts.some((a) => a.secret === data.secret)) {
        Alert.alert('Cuenta duplicada', 'Esa semilla ya está registrada.');
        return false;
      }
      const next = [...accounts, { id: newAccountId(), ...data }];
      await saveAccounts(next);
      setAccounts(next);
      return true;
    },
    [accounts],
  );

  const removeAccount = (acc: TotpAccount) =>
    Alert.alert('Eliminar cuenta', `¿Eliminar "${acc.issuer || acc.label}"? Perderás el acceso a sus códigos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          const next = accounts.filter((a) => a.id !== acc.id);
          await saveAccounts(next);
          setAccounts(next);
        },
      },
    ]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Title>Authenticator</Title>
          <Muted>Offline · RFC 6238 · HMAC-SHA1 propio</Muted>
        </View>
        {onBack ? <Button title="Volver" variant="ghost" onPress={onBack} style={{ paddingVertical: 8 }} /> : null}
      </View>

      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ gap: 12, paddingVertical: 12 }}
        ListEmptyComponent={
          <Card>
            <Muted>Aún no hay cuentas. Escanea un QR otpauth:// o pega la semilla Base32.</Muted>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => removeAccount(item)}>
            <Card style={{ gap: 6 }}>
              <Text style={styles.issuer}>{item.issuer || 'Sin emisor'}</Text>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={[styles.code, urgent && { color: colors.danger }]}>{formatCode(codes[item.id] ?? '------')}</Text>
              <View style={styles.track}>
                <View
                  style={[styles.bar, { width: `${fraction * 100}%`, backgroundColor: urgent ? colors.danger : colors.primary }]}
                />
              </View>
              <Text style={styles.seconds}>{Math.ceil(remaining)} s</Text>
            </Card>
          </Pressable>
        )}
      />

      <Muted style={{ textAlign: 'center', marginBottom: 8 }}>Mantén presionada una cuenta para eliminarla.</Muted>
      <Button title="+ Agregar cuenta" onPress={() => setAdding(true)} />

      <AddAccountModal visible={adding} onClose={() => setAdding(false)} onAdd={addAccount} />
    </View>
  );
}

// -------------------------------------------------------------------------------------------

function AddAccountModal({
  visible, onClose, onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (d: { issuer: string; label: string; secret: string }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'scan' | 'manual'>('manual');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setScanned(false); setError(null); setIssuer(''); setLabel(''); setSecret('');
    }
  }, [visible]);

  const finish = async (data: { issuer: string; label: string; secret: string }) => {
    const ok = await onAdd(data);
    if (ok) onClose();
    else setScanned(false);
  };

  const onBarcode = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    try {
      void finish(parseOtpauthUri(data));
    } catch (e) {
      setError((e as Error).message);
      setTimeout(() => setScanned(false), 1500);
    }
  };

  const submitManual = () => {
    setError(null);
    try {
      if (secret.trim().toLowerCase().startsWith('otpauth://')) {
        const parsed = parseOtpauthUri(secret.trim());
        validateSecret(parsed.secret);
        void finish(parsed);
        return;
      }
      const clean = validateSecret(secret);
      void finish({ issuer: issuer.trim(), label: label.trim() || 'Cuenta', secret: clean });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Title>Agregar cuenta</Title>
        <View style={styles.tabs}>
          {(['manual', 'scan'] as const).map((m) => (
            <Pressable key={m} onPress={() => { setMode(m); setError(null); }} style={[styles.tab, mode === m && styles.tabActive]}>
              <Text style={{ color: mode === m ? colors.onPrimary : colors.text, fontWeight: '700' }}>{m === 'manual' ? 'Pegar semilla' : 'Escanear QR'}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'scan' ? (
          permission?.granted ? (
            <View style={styles.cameraBox}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : onBarcode}
              />
            </View>
          ) : (
            <Card style={{ gap: 12 }}>
              <Muted>Se necesita permiso de cámara para escanear el QR.</Muted>
              <Button title="Dar permiso de cámara" onPress={requestPermission} />
            </Card>
          )
        ) : (
          <View style={{ gap: 10 }}>
            <TextInput style={styles.input} placeholder="Emisor (ej. UniSabana)" placeholderTextColor={colors.muted} value={issuer} onChangeText={setIssuer} />
            <TextInput style={styles.input} placeholder="Cuenta (ej. estudiante@unisabana.edu.co)" placeholderTextColor={colors.muted} autoCapitalize="none" value={label} onChangeText={setLabel} />
            <TextInput
              style={[styles.input, { fontFamily: mono }]}
              placeholder="Semilla Base32 u otpauth://…"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              value={secret}
              onChangeText={setSecret}
            />
            <Button title="Guardar" onPress={submitManual} disabled={!secret.trim()} />
          </View>
        )}

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        <Button title="Cancelar" variant="ghost" onPress={onClose} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  issuer: {
    alignSelf: 'flex-start', backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1.2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden',
  },
  label: { color: colors.muted, fontSize: 14 },
  code: { color: colors.primary, fontSize: 48, fontFamily: mono, fontWeight: '800', letterSpacing: 3, marginVertical: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  seconds: { color: colors.muted, fontSize: 12, fontWeight: '600', textAlign: 'right' },
  modal: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 56, gap: 14 },
  tabs: { flexDirection: 'row', gap: 8, padding: 5, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, padding: 11, borderRadius: 999, alignItems: 'center' },
  tabActive: { backgroundColor: colors.primary },
  cameraBox: { height: 320, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1.5, color: colors.text, borderRadius: 16, padding: 15, fontSize: 16 },
});
