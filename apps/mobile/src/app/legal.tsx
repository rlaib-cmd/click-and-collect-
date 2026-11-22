import { messages } from '@splash360/i18n';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { z } from 'zod';
import { apiGet } from '@/api/client';
import { Loading, PrimaryButton, Screen } from '@/components/ui';
import { titleStyle } from '@/components/brand';
import { useTenant } from '@/tenant/TenantProvider';

/** Conditions générales de vente et mentions légales, saisies par l'enseigne au back-office. */
export default function LegalScreen() {
  const { config, palette, style: brand } = useTenant();
  const sub = config.tenant.subdomain;
  const legal = useQuery({
    queryKey: ['legal', sub],
    queryFn: () => apiGet(`/v1/tenants/${sub}/legal`, z.object({ text: z.string().nullable() })),
  });
  if (legal.isPending) return <Loading />;
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {messages.legal.title}
        </Text>
        <Text style={{ color: palette.text, lineHeight: 22 }}>
          {legal.data?.text ?? messages.legal.pending(config.tenant.name)}
        </Text>
        <PrimaryButton label={messages.product.close} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
});
