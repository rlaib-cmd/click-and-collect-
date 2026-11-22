import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { PrimaryButton, Screen } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

/**
 * Conditions générales de vente et mentions légales de l'enseigne.
 * Le texte est fourni par chaque enseigne (back-office, lot 6) ; en attendant, un emplacement réservé.
 */
export default function LegalScreen() {
  const { config, palette } = useTenant();
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {messages.legal.title}
        </Text>
        <Text style={{ color: palette.text }}>{messages.legal.pending(config.tenant.name)}</Text>
        <PrimaryButton label={messages.product.close} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
});
