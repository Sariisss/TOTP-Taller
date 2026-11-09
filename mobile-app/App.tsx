import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import AuthenticatorScreen from './src/screens/AuthenticatorScreen';
import SessionScreen from './src/screens/SessionScreen';
import VaultScreen from './src/screens/VaultScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { colors } from './src/ui/theme';

// Necesario para cerrar correctamente la sesión del navegador al volver por deep link.
WebBrowser.maybeCompleteAuthSession();

type Tab = 'authenticator' | 'vault' | 'session';
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'authenticator', label: 'Authenticator', icon: '🔢' },
  { key: 'vault', label: 'Bóveda', icon: '🔐' },
  { key: 'session', label: 'Sesión', icon: '👤' },
];

function Root() {
  const { status } = useAuth();
  const [tab, setTab] = useState<Tab>('authenticator');
  const [showAuthenticator, setShowAuthenticator] = useState(false);

  if (status === 'loading') {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  if (status === 'signedOut') {
    return showAuthenticator ? (
      <AuthenticatorScreen onBack={() => setShowAuthenticator(false)} />
    ) : (
      <WelcomeScreen onOpenAuthenticator={() => setShowAuthenticator(true)} />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'authenticator' && <AuthenticatorScreen />}
        {tab === 'vault' && <VaultScreen />}
        {tab === 'session' && <SessionScreen />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={{ fontSize: 18 }}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.key && { color: colors.primary, fontWeight: '800' }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <AuthProvider>
          <Root />
        </AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBar: {
    flexDirection: 'row', gap: 6, padding: 6, marginHorizontal: 16, marginBottom: 10, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 },
  tabActive: { backgroundColor: colors.primarySoft },
  tabLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', marginTop: 2 },
});
