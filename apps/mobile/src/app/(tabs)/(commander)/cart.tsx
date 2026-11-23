import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAvailability, useMenu } from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { BackButton, ErrorState, Loading, PrimaryButton, Screen } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { displayCart } from '@/menu/display';
import { titleStyle } from '@/components/brand';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { useTenant } from '@/tenant/TenantProvider';

/** Panier (lot 2 : contenu et quantités ; récapitulatif, frais et minimum au lot 3). */
export default function CartScreen() {
  const { cart, dispatch } = useCart();
  const { palette, style: brand } = useTenant();
  const insets = useSafeAreaInsets();
  const restaurantId = cart.restaurantId ?? '';
  const menu = useMenu(restaurantId);
  const availability = useAvailability(cart.restaurantId);

  if (!cart.restaurantId || cart.lines.length === 0) {
    return <ErrorState message={messages.cart.empty} onRetry={() => router.replace('/')} />;
  }
  if (menu.isPending) return <Loading />;
  if (menu.isError)
    return <ErrorState message={messages.menu.menuError} onRetry={() => void menu.refetch()} />;

  const { lines, subtotalCents } = displayCart(menu.data, cart.lines);
  const minimum =
    cart.setup.mode === 'delivery' ? (availability.data?.delivery?.minimumCents ?? 0) : 0;
  const missing = Math.max(0, minimum - subtotalCents);
  // Cadeau fidélité retenu (lot 11) : rappel, et avertissement s'il n'y a rien de payant à côté.
  const giftName = cart.reward
    ? (lines.find((l) => l.product?.id === cart.reward?.productId)?.product?.name ?? null)
    : null;
  const onlyGift =
    cart.reward !== null && cart.lines.every((l) => l.productId === cart.reward?.productId);

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text
          style={[styles.title, titleStyle(brand), { color: palette.text }]}
          accessibilityRole="header"
        >
          {messages.cart.title}
        </Text>
        {lines.map(({ line, product, optionNames, totalCents }) => (
          <View key={line.key} style={[styles.line, { borderColor: palette.border }]}>
            <View style={styles.lineText}>
              <Text style={[styles.name, { color: product ? palette.text : palette.textMuted }]}>
                {product ? product.name : messages.cart.unknownItem}
              </Text>
              {optionNames.length > 0 ? (
                <Text style={{ color: palette.textMuted }}>{optionNames.join(', ')}</Text>
              ) : null}
              {line.note ? (
                <Text style={{ color: palette.textMuted, fontStyle: 'italic' }}>{line.note}</Text>
              ) : null}
              <View style={styles.qtyRow}>
                <Qty
                  label="−"
                  onPress={() =>
                    dispatch({ type: 'setQuantity', key: line.key, quantity: line.quantity - 1 })
                  }
                />
                <Text style={[styles.qty, { color: palette.text }]}>{line.quantity}</Text>
                <Qty
                  label="+"
                  onPress={() =>
                    dispatch({ type: 'setQuantity', key: line.key, quantity: line.quantity + 1 })
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => dispatch({ type: 'remove', key: line.key })}
                  style={styles.remove}
                >
                  <Text style={{ color: palette.accent }}>{messages.cart.remove}</Text>
                </Pressable>
              </View>
            </View>
            <Text style={[styles.price, { color: palette.text }]}>
              {product ? formatPrice(totalCents) : ''}
            </Text>
          </View>
        ))}
        {giftName ? (
          <View
            style={[styles.gift, { backgroundColor: palette.loyalty }]}
            accessibilityRole="alert"
          >
            <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>
              {messages.loyalty.giftInCart(giftName)}
            </Text>
            {onlyGift ? (
              <Text style={{ color: palette.onLoyalty, fontSize: 13 }}>
                {messages.checkout.issue.reward_needs_paid_items}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/r/[restaurantId]', params: { restaurantId } })}
          style={styles.more}
        >
          <Text style={{ color: palette.accent, fontWeight: '600', fontSize: 16 }}>
            + {messages.cart.addMore}
          </Text>
        </Pressable>
        <View style={[styles.subtotal, { borderColor: palette.border }]}>
          <Text style={[styles.subtotalLabel, { color: palette.text }]}>
            {messages.cart.subtotal}
          </Text>
          <Text style={[styles.subtotalLabel, { color: palette.text }]}>
            {formatPrice(subtotalCents)}
          </Text>
        </View>
        {missing > 0 ? (
          <Text style={[styles.minimum, { color: palette.accent }]} accessibilityRole="alert">
            {messages.checkout.belowMinimum(formatPrice(missing))}
          </Text>
        ) : null}
      </ScrollView>
      <View
        style={[styles.footer, { borderColor: palette.border, paddingBottom: TAB_BAR_CLEARANCE }]}
      >
        <PrimaryButton
          label={messages.cart.checkout}
          disabled={missing > 0 || lines.some((l) => l.product === null)}
          onPress={() => router.push('/checkout')}
        />
      </View>
    </Screen>
  );
}

function Qty({ label, onPress }: { label: string; onPress: () => void }) {
  const { palette } = useTenant();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.qtyButton, { borderColor: palette.border }]}
    >
      <Text style={{ color: palette.text, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gift: { padding: 12, borderRadius: 12, gap: 2, marginTop: 8 },
  content: { padding: 16, gap: 4 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 12 },
  line: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineText: { flex: 1, gap: 4 },
  name: { fontSize: 17, fontWeight: '600' },
  price: { fontSize: 16, fontWeight: '600' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  qtyButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { minWidth: 20, textAlign: 'center', fontWeight: '700', fontSize: 16 },
  remove: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center' },
  more: { minHeight: 48, justifyContent: 'center' },
  subtotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  subtotalLabel: { fontSize: 18, fontWeight: '700' },
  minimum: { marginTop: 12, fontSize: 15, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
