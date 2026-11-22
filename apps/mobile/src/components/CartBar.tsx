import type { MenuDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '@/cart/CartProvider';
import { formatPrice } from '@/lib/format';
import { displayCart } from '@/menu/display';
import { useTenant } from '@/tenant/TenantProvider';
import { PrimaryButton } from './ui';

/** Barre panier en bas de la carte, dès qu'il y a un article. */
export function CartBar({ menu }: { menu: MenuDto }) {
  const { cart, count } = useCart();
  const { palette } = useTenant();
  const insets = useSafeAreaInsets();
  if (count === 0 || cart.restaurantId !== menu.restaurantId) return null;
  const { subtotalCents } = displayCart(menu, cart.lines);
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          paddingBottom: 12 + insets.bottom,
        },
      ]}
    >
      <PrimaryButton
        label={messages.cart.view(count, formatPrice(subtotalCents))}
        onPress={() => router.push('/cart')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
