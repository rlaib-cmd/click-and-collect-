import { messages } from '@splash360/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCart } from '@/cart/CartProvider';
import { PrimaryButton, Screen } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

/** Suivi de commande (lot 3 : commande créée, en attente de paiement ; paiement au lot 4, suivi au lot 5). */
export default function OrderScreen() {
  const { number } = useLocalSearchParams<{ orderId: string; number?: string }>();
  const { palette } = useTenant();
  const { dispatch } = useCart();

  useEffect(() => {
    dispatch({ type: 'clear' });
  }, [dispatch]);

  return (
    <Screen>
      <View style={styles.box}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {messages.order.title(Number(number ?? 0))}
        </Text>
        <Text style={[styles.status, { color: palette.accent }]}>
          {messages.order.pendingPayment}
        </Text>
        <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
          {messages.order.paymentNext}
        </Text>
        <PrimaryButton label={messages.order.backHome} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', alignItems: 'stretch' },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  status: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
});
