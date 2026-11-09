import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from './theme';

export function Button({
  title, onPress, variant = 'primary', disabled, loading, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : 'transparent';
  const border = variant === 'ghost' ? colors.ink : bg;
  const textColor = variant === 'ghost' ? colors.ink : colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.btnText, { color: textColor }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  btn: { paddingVertical: 15, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', borderWidth: 1.5 },
  btnText: { fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.card, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#1B2A22', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});
