import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRestaurants } from '@/api/hooks';
import { TenantLogo } from '@/components/TenantLogo';
import { ErrorState, Loading, PrimaryButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

/**
 * Accueil. Lot 2 : choix du restaurant puis accès à la carte.
 * Le choix du mode, de l'adresse et de l'heure arrive au lot 3.
 */
export default function HomeScreen() {
  const { config, palette } = useTenant();
  const { tenant, theme } = config;
  const restaurants = useRestaurants();

  if (restaurants.isPending) return <Loading />;
  if (restaurants.isError) {
    return (
      <ErrorState
        message={messages.tenant.networkError}
        onRetry={() => void restaurants.refetch()}
      />
    );
  }

  const list = restaurants.data;
  const open = (id: string) =>
    router.push({ pathname: '/r/[restaurantId]', params: { restaurantId: id } });

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <TenantLogo />
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        {tenant.name}
      </Text>
      {theme.tagline ? (
        <Text style={[styles.tagline, { color: palette.textMuted }]}>{theme.tagline}</Text>
      ) : null}

      {list.length === 1 && list[0] ? (
        <PrimaryButton
          label={messages.app.order}
          onPress={() => open(list[0]?.id ?? '')}
          style={styles.cta}
        />
      ) : (
        <View style={styles.list}>
          <Text style={[styles.subtitle, { color: palette.text }]}>
            {messages.menu.chooseRestaurant}
          </Text>
          {list.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => open(r.id)}
              style={[
                styles.restaurant,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              <Text style={[styles.restaurantName, { color: palette.text }]}>{r.name}</Text>
              <Text style={{ color: palette.textMuted }}>
                {r.addressLine}, {r.postalCode} {r.city}
              </Text>
              {r.status === 'paused' ? (
                <Text style={{ color: palette.accent }}>{messages.menu.paused}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  tagline: { fontSize: 16, textAlign: 'center' },
  cta: { marginTop: 16, minWidth: 220 },
  list: { alignSelf: 'stretch', gap: 10, marginTop: 16, maxWidth: 560, width: '100%' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  restaurant: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 4, minHeight: 44 },
  restaurantName: { fontSize: 17, fontWeight: '600' },
});
