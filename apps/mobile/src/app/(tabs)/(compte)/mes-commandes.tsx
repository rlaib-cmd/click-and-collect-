import type { MemberOrdersDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMemberOrders } from '@/api/hooks';
import { lineKey } from '@/cart/cart';
import { useCart } from '@/cart/CartProvider';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { BackButton, ErrorState, Loading, PrimaryButton } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { saveOrder } from '@/orders/storage';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.account;
type MemberOrder = MemberOrdersDto['orders'][number];

/** Mes commandes (lot 11) : historique du membre, suivi et « Recommander ». */
export default function MyOrdersScreen() {
  const { palette, style, config } = useTenant();
  const { memberToken } = useLoyalty();
  const { cart, dispatch } = useCart();
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<(number | null)[]>([null]);
  const last = pages[pages.length - 1] ?? null;
  const current = useMemberOrders(memberToken, last);
  const [loaded, setLoaded] = useState<MemberOrder[]>([]);
  const orders = [
    ...loaded,
    ...(current.data?.orders.filter((o) => !loaded.some((l) => l.orderId === o.orderId)) ?? []),
  ];

  const open = async (o: MemberOrder) => {
    // Le jeton de suivi reste sur l'appareil, comme pour une commande passée ici.
    await saveOrder(config.tenant.subdomain, {
      orderId: o.orderId,
      number: o.number,
      accessToken: o.accessToken,
      createdAt: o.createdAt,
      summary: o.items.map((i) => `${i.quantity} × ${i.name}`).join(', '),
    });
    router.push({ pathname: '/order/[orderId]', params: { orderId: o.orderId, from: 'history' } });
  };

  const reorder = (o: MemberOrder) => {
    dispatch({
      type: 'restore',
      state: {
        restaurantId: o.restaurantId,
        lines: o.items.map((i) => ({
          key: lineKey(i.productId, i.optionIds, i.note),
          productId: i.productId,
          quantity: i.quantity,
          optionIds: [...i.optionIds],
          note: i.note,
        })),
        setup: { ...cart.setup, time: { kind: 'asap' } },
        reward: null,
      },
    });
    router.navigate('/cart');
  };

  const header = (
    <View style={styles.header}>
      <BackButton color={palette.accent} />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.orders}
      </Text>
    </View>
  );

  if (current.isPending && orders.length === 0) return <Loading />;
  if (current.isError && orders.length === 0)
    return (
      <ErrorState message={messages.tenant.networkError} onRetry={() => void current.refetch()} />
    );

  if (orders.length === 0) {
    return (
      <View
        style={[styles.page, { backgroundColor: palette.background, paddingTop: insets.top + 8 }]}
      >
        {header}
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: palette.surface }]}>
            <Icon name="receipt" color={palette.loyalty} size={56} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>{t.noOrdersTitle}</Text>
          <Text style={{ color: palette.textMuted, textAlign: 'center' }}>{t.noOrdersHint}</Text>
          <PrimaryButton label={t.exploreMenu} onPress={() => router.navigate('/commander')} />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.list,
        { paddingTop: insets.top + 8, paddingBottom: TAB_BAR_CLEARANCE + 24 },
      ]}
      data={orders}
      keyExtractor={(o) => o.orderId}
      ListHeaderComponent={header}
      renderItem={({ item }) => <OrderCard order={item} onOpen={open} onReorder={reorder} />}
      ListFooterComponent={
        current.data?.nextBefore ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLoaded(orders);
              setPages((p) => [...p, current.data?.nextBefore ?? null]);
            }}
            style={styles.more}
          >
            <Text style={{ color: palette.accent, fontWeight: '800' }}>{t.loadMore}</Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}

function OrderCard({
  order,
  onOpen,
  onReorder,
}: {
  order: MemberOrder;
  onOpen: (o: MemberOrder) => void;
  onReorder: (o: MemberOrder) => void;
}) {
  const { palette, radii } = useTenant();
  const status = (messages.order.status as Record<string, string>)[order.status] ?? order.status;
  const date = new Date(order.createdAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderRadius: radii.card + 4,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => void onOpen(order)}
        style={styles.cardBody}
      >
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {t.orderLine(order.number, date)}
          </Text>
          <Text style={[styles.total, { color: palette.text }]}>
            {formatPrice(order.totalCents)}
          </Text>
        </View>
        <Text style={{ color: palette.loyalty, fontWeight: '700' }}>{status}</Text>
        <Text style={{ color: palette.textMuted }} numberOfLines={2}>
          {order.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}
        </Text>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>{order.restaurantName}</Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onOpen(order)}
          style={[styles.action, { borderColor: palette.border, borderRadius: radii.button }]}
        >
          <Text style={{ color: palette.text, fontWeight: '700' }}>{t.track}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onReorder(order)}
          style={[
            styles.action,
            {
              backgroundColor: palette.loyalty,
              borderColor: palette.loyalty,
              borderRadius: radii.button,
            },
          ]}
        >
          <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>{t.reorder}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 16 },
  header: { gap: 8, marginBottom: 8 },
  h1: { fontSize: 26, fontWeight: '900' },
  list: { paddingHorizontal: 16, gap: 12 },
  empty: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 14, paddingBottom: 80 },
  emptyIcon: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardBody: { padding: 14, gap: 4 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800', flex: 1 },
  total: { fontSize: 16, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  action: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  more: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
