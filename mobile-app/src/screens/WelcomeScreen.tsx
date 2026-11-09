import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { OAuthCancelledError } from '../auth/oauth';
import { Button, Card, Muted, Title } from '../ui/components';
import { colors } from '../ui/theme';

export default function WelcomeScreen({ onOpenAuthenticator }: { onOpenAuthenticator: () => void }) {
  const { signIn, bootMessage } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (e) {
      if (!(e instanceof OAuthCancelledError)) Alert.alert('No se pudo iniciar sesión', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.circle} />
      <View style={{ gap: 10 }}>
        <View style={styles.badge} />
        <Title>Seguridad Móvil</Title>
        <Muted>OAuth 2.0 + PKCE · Silent Refresh · Step-Up 2FA (TOTP)</Muted>
      </View>

      {bootMessage ? (
        <Card style={{ borderColor: colors.warning }}>
          <Muted style={{ color: colors.warning }}>{bootMessage}</Muted>
        </Card>
      ) : null}

      <Card style={{ gap: 12 }}>
        <Muted>
          El login se hace en el navegador del sistema (no en una WebView). La app nunca ve tu contraseña.
        </Muted>
        <Button title="Iniciar sesión" onPress={handleSignIn} loading={busy} />
      </Card>

      <Card style={{ gap: 12 }}>
        <Muted>El Authenticator funciona 100% offline, incluso en Modo Avión y sin iniciar sesión.</Muted>
        <Button title="Abrir Authenticator" variant="ghost" onPress={onOpenAuthenticator} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 18, justifyContent: 'center' },
  circle: { position: 'absolute', top: -70, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: colors.primarySoft },
  badge: { width: 48, height: 8, borderRadius: 4, backgroundColor: colors.primary },
});
