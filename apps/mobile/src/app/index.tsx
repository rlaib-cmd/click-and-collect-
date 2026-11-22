import { messages } from '@splash360/i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TenantLogo } from '@/components/TenantLogo';
import { useTenant } from '@/tenant/TenantProvider';

export default function HomeScreen() {
  const { config, palette } = useTenant();
  const { tenant, theme } = config;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <TenantLogo />
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        {tenant.name}
      </Text>
      {theme.tagline ? (
        <Text style={[styles.tagline, { color: palette.textMuted }]}>{theme.tagline}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{messages.app.order}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  tagline: { fontSize: 16, textAlign: 'center' },
  button: {
    marginTop: 16,
    minHeight: 48,
    minWidth: 200,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
});
