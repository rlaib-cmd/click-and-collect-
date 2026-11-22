import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useTenant } from '@/tenant/TenantProvider';

/** Bouton principal aux couleurs de l'enseigne ; zone tactile ≥ 44 points. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { palette, radii, style: brand } = useTenant();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: disabled ? palette.border : palette.primary,
          borderRadius: radii.button,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.primaryText,
          brand.uppercaseTitles ? styles.upper : null,
          { color: disabled ? palette.textMuted : palette.onPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={styles.center} accessibilityLabel={messages.app.loading}>
      <ActivityIndicator />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { palette } = useTenant();
  return (
    <View style={[styles.center, { backgroundColor: palette.background }]}>
      <Text style={[styles.message, { color: palette.text }]} accessibilityRole="alert">
        {message}
      </Text>
      {onRetry ? <PrimaryButton label={messages.app.retry} onPress={onRetry} /> : null}
    </View>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  const { palette } = useTenant();
  return <View style={[styles.screen, { backgroundColor: palette.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  backText: { fontSize: 17, fontWeight: '700' },
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  message: { fontSize: 16, textAlign: 'center' },
  primary: {
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '700' },
  upper: { textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0.5 },
});

/**
 * Retour à l'écran précédent ; à défaut (lien ouvert directement), retour aux onglets.
 * Les écrans de commande sont hors de la barre d'onglets : ce bouton permet d'y revenir.
 */
export function BackButton({ color }: { color?: string }) {
  const { palette } = useTenant();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={messages.app.back}
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/commander'))}
      style={styles.back}
    >
      <Text style={[styles.backText, { color: color ?? palette.accent }]}>
        ‹ {messages.app.back}
      </Text>
    </Pressable>
  );
}
