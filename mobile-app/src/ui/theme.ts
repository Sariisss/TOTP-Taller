import { Platform } from 'react-native';

export const colors = {
  bg: '#F3EFE6',
  card: '#FFFFFF',
  border: '#E2DCCD',
  text: '#16201D',
  muted: '#6E766F',
  primary: '#0E5C4A',
  primarySoft: '#DDEBE4',
  onPrimary: '#FFFFFF',
  ink: '#16201D',
  success: '#1F9D55',
  danger: '#D6453D',
  warning: '#B7791F',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
