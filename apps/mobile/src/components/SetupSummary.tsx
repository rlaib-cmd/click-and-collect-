import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAvailability } from '@/api/hooks';
import { useCart } from '@/cart/CartProvider';
import { formatDay, formatTime, localDate } from '@/lib/dates';
import { useTenant } from '@/tenant/TenantProvider';

/** Rappel du mode et de l'heure, modifiable (écrans Carte et Récapitulatif). */
export function SetupSummary() {
  const { cart } = useCart();
  const { palette } = useTenant();
  const availability = useAvailability(cart.restaurantId);
  const tz = availability.data?.timezone ?? 'Europe/Paris';
  const { mode, time, address } = cart.setup;
  const when =
    time.kind === 'asap'
      ? messages.setup.asap
      : `${formatDay(localDate(new Date(time.at), tz), new Date(), tz, messages.setup)} · ${formatTime(time.at, tz)}`;

  return (
    <View style={[styles.box, { backgroundColor: palette.surface }]}>
      <View style={styles.text}>
        <Text style={[styles.main, { color: palette.text }]}>
          {messages.setup[mode]} · {when}
        </Text>
        {mode === 'delivery' && address ? (
          <Text style={{ color: palette.textMuted }} numberOfLines={1}>
            {address.label}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/')}
        style={styles.edit}
      >
        <Text style={{ color: palette.accent, fontWeight: '600' }}>{messages.setup.edit}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  text: { flex: 1, gap: 2 },
  main: { fontWeight: '600', fontSize: 15 },
  edit: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
});
