import { messages } from '@splash360/i18n';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOrderTracking } from '@/api/hooks';
import { parseStoredCart, reorderCart } from '@/cart/cart';
import { useCart } from '@/cart/CartProvider';
import { listSavedOrders, type SavedOrder } from '@/orders/storage';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { Icon } from './icons';

const ACTIVE_FOR_MS = 24 * 60 * 60 * 1000;
const FINISHED = ['completed', 'cancelled', 'refunded', 'payment_failed'];

/** Commandes de cet appareil, relues à chaque retour sur l'écran. */
function useSavedOrders(): SavedOrder[] {
  const { config } = useTenant();
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  useFocusEffect(
    useCallback(() => {
      void listSavedOrders(config.tenant.subdomain).then(setOrders);
    }, [config.tenant.subdomain]),
  );
  return orders;
}

/**
 * Accueil : bandeau de la commande du jour (statut, QR code de retrait) et
 * « Commander comme la dernière fois ».
 */
export function OrderShortcuts() {
  const orders = useSavedOrders();
  const latest = orders[0];
  const recent =
    latest && Date.now() - Date.parse(latest.createdAt) < ACTIVE_FOR_MS ? latest : undefined;
  const last = orders.find((o) => o.cart);
  return (
    <View style={styles.wrap}>
      {recent ? <CurrentOrderBanner order={recent} /> : null}
      {last ? <ReorderButton order={last} /> : null}
    </View>
  );
}

function CurrentOrderBanner({ order }: { order: SavedOrder }) {
  const { palette, radii, style } = useTenant();
  const tracking = useOrderTracking(order.orderId, order.accessToken);
  const data = tracking.data;
  if (!data || FINISHED.includes(data.status)) return null;
  const toPay = data.status === 'pending_payment';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/order/[orderId]', params: { orderId: order.orderId } })
      }
      style={[styles.banner, { backgroundColor: palette.text, borderRadius: radii.card + 6 }]}
    >
      <View style={styles.bannerText}>
        <Text style={[styles.bannerTitle, titleStyle(style), { color: palette.background }]}>
          {messages.current.title(data.number)}
        </Text>
        <Text style={{ color: palette.background, opacity: 0.85 }}>
          {messages.order.status[data.status]}
        </Text>
        <Text style={{ color: palette.background, fontWeight: '800' }}>
          {toPay ? messages.current.follow : messages.current.showQr} →
        </Text>
      </View>
      <View style={[styles.qr, { backgroundColor: palette.primary, borderRadius: radii.card }]}>
        <Icon name="qr" color={palette.onPrimary} size={30} />
      </View>
    </Pressable>
  );
}

function ReorderButton({ order }: { order: SavedOrder }) {
  const { palette, radii, style } = useTenant();
  const { dispatch } = useCart();
  const reorder = () => {
    const cart = reorderCart(parseStoredCart(order.cart ?? null));
    if (!cart) return;
    dispatch({ type: 'restore', state: cart });
    router.push('/cart');
  };
  return (
    <Pressable
      accessibilityRole="button"
      onPress={reorder}
      style={[
        styles.reorder,
        { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radii.card },
      ]}
    >
      <View style={styles.bannerText}>
        <Text style={[styles.reorderTitle, titleStyle(style), { color: palette.text }]}>
          {messages.reorder.title}
        </Text>
        {order.summary ? (
          <Text style={{ color: palette.textMuted }} numberOfLines={2}>
            {order.summary}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: palette.accent, fontWeight: '800' }}>{messages.reorder.action} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  bannerText: { flex: 1, gap: 4 },
  bannerTitle: { fontSize: 20, fontWeight: '900' },
  qr: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    minHeight: 56,
  },
  reorderTitle: { fontSize: 16, fontWeight: '800' },
});
