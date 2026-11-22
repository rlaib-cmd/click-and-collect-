import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAvailability, useDeliveryCheck, useRestaurants } from '@/api/hooks';
import type { OrderSetup } from '@/cart/cart';
import { useCart } from '@/cart/CartProvider';
import { SetupForm } from '@/components/SetupForm';
import { TenantLogo } from '@/components/TenantLogo';
import { ErrorState, Loading, PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

/** Accueil : restaurant, mode, adresse, jour et heure, puis la carte. */
export default function HomeScreen() {
  const { config, palette } = useTenant();
  const { cart, dispatch } = useCart();
  const insets = useSafeAreaInsets();
  const restaurants = useRestaurants();
  const list = restaurants.data ?? [];
  const restaurantId =
    list.find((r) => r.id === cart.restaurantId)?.id ??
    (list.length === 1 ? (list[0]?.id ?? null) : null);
  const availability = useAvailability(restaurantId);
  const setup = cart.setup;
  const check = useDeliveryCheck(setup.mode === 'delivery' ? restaurantId : null, setup.address);
  const [planning, setPlanning] = useState(setup.time.kind === 'scheduled');

  const update = useCallback(
    (patch: Partial<OrderSetup>) => {
      if (restaurantId) dispatch({ type: 'setup', restaurantId, setup: patch });
    },
    [dispatch, restaurantId],
  );

  if (restaurants.isPending) return <Loading />;
  if (restaurants.isError) {
    return (
      <ErrorState
        message={messages.tenant.networkError}
        onRetry={() => void restaurants.refetch()}
      />
    );
  }

  const a = availability.data;
  const timeReady =
    setup.time.kind === 'scheduled' ? true : !planning && a?.asap.available === true;
  const addressReady =
    setup.mode === 'pickup' || (setup.address !== null && check.data?.deliverable === true);
  const ready = Boolean(restaurantId && a && !a.paused && timeReady && addressReady);

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.brand}>
        <TenantLogo />
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {config.tenant.name}
        </Text>
        {config.theme.tagline ? (
          <Text style={[styles.tagline, { color: palette.textMuted }]}>{config.theme.tagline}</Text>
        ) : null}
      </View>

      {list.length > 1 ? (
        <View style={styles.list}>
          <Text style={[styles.subtitle, { color: palette.text }]}>
            {messages.menu.chooseRestaurant}
          </Text>
          {list.map((r) => {
            const selected = r.id === restaurantId;
            return (
              <Pressable
                key={r.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => dispatch({ type: 'setup', restaurantId: r.id, setup: {} })}
                style={[
                  styles.restaurant,
                  {
                    borderColor: selected ? palette.accent : palette.border,
                    backgroundColor: palette.surface,
                  },
                ]}
              >
                <Text style={[styles.restaurantName, { color: palette.text }]}>{r.name}</Text>
                <Text style={{ color: palette.textMuted }}>
                  {r.addressLine}, {r.postalCode} {r.city}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {restaurantId && availability.isPending ? <Loading /> : null}
      {restaurantId && availability.isError ? (
        <ErrorState
          message={messages.tenant.networkError}
          onRetry={() => void availability.refetch()}
        />
      ) : null}
      {restaurantId && a ? (
        <View style={styles.list}>
          {a.paused ? (
            <Text style={[styles.notice, { color: palette.accent }]} accessibilityRole="alert">
              {messages.setup.paused}
            </Text>
          ) : null}
          {!a.paused && !a.asap.available && a.dates.length > 0 ? (
            <Text style={[styles.notice, { color: palette.textMuted }]}>
              {messages.setup.schedulingOnly}
            </Text>
          ) : null}
          <SetupForm
            restaurantId={restaurantId}
            availability={a}
            setup={setup}
            onChange={update}
            planning={planning}
            onPlanningChange={setPlanning}
          />
          <PrimaryButton
            label={messages.setup.seeMenu}
            disabled={!ready}
            onPress={() => router.push({ pathname: '/r/[restaurantId]', params: { restaurantId } })}
            style={styles.cta}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 16, paddingHorizontal: 16 },
  brand: { alignItems: 'center', gap: 8 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  tagline: { fontSize: 16, textAlign: 'center' },
  cta: { marginTop: 8 },
  list: { alignSelf: 'stretch', gap: 12, maxWidth: 560, width: '100%', marginHorizontal: 'auto' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  restaurant: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 4, minHeight: 44 },
  restaurantName: { fontSize: 17, fontWeight: '600' },
  notice: { fontSize: 15 },
});
