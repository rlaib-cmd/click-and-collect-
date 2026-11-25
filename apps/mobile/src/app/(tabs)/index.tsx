import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckerBand, titleStyle } from '@/components/brand';
import { OrderShortcuts } from '@/components/CurrentOrder';
import { AmbassadorCard } from '@/components/AmbassadorCard';
import { FeaturedProducts } from '@/components/FeaturedProducts';
import { FidelityCard, JoinCard } from '@/components/loyalty';
import { TenantLogo } from '@/components/TenantLogo';
import { useCart } from '@/cart/CartProvider';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { tierProducts, useRewardCatalog } from '@/loyalty/rewards';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.loyalty;

/** Accueil (lot 8) : commander en un geste, puis le club fidélité. */
export default function HomeScreen() {
  const { config, palette, style, radii } = useTenant();
  const { program, member } = useLoyalty();
  const insets = useSafeAreaInsets();
  const brand = style.header === 'brand';
  const club = program?.enabled ? program : null;
  const { cart } = useCart();
  const catalog = useRewardCatalog(cart);

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.page}>
      <View
        style={[
          styles.hero,
          { paddingTop: insets.top + 8 },
          brand
            ? { backgroundColor: palette.primary }
            : { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
        ]}
      >
        {brand && config.theme.logoUrl ? <TenantLogo size={36} wide /> : <TenantLogo size={48} />}
        {!brand || !config.theme.logoUrl ? (
          <Text
            style={[styles.brandName, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {config.tenant.name}
          </Text>
        ) : null}
      </View>
      {brand ? <CheckerBand /> : null}

      <View style={styles.content}>
        {member ? (
          <Text style={{ color: palette.textMuted, fontSize: 15 }}>{t.hello(member.name)}</Text>
        ) : null}

        <OrderShortcuts />

        <AmbassadorCard />

        <View
          style={[styles.order, { backgroundColor: palette.primary, borderRadius: radii.card + 6 }]}
        >
          <Text style={[styles.orderTitle, titleStyle(style), { color: palette.onPrimary }]}>
            {t.orderOnline}
          </Text>
          <Text style={{ color: palette.onPrimary, opacity: 0.85 }}>{t.orderHint}</Text>
          <View style={styles.orderButtons}>
            {(['pickup', 'delivery'] as const).map((mode) => (
              <Pressable
                key={mode}
                accessibilityRole="button"
                onPress={() => router.navigate({ pathname: '/commander', params: { mode } })}
                style={[
                  styles.orderButton,
                  { borderRadius: radii.button, borderColor: palette.onPrimary },
                  mode === 'pickup' ? { backgroundColor: palette.onPrimary } : null,
                ]}
              >
                <Text
                  style={{
                    color: mode === 'pickup' ? palette.primary : palette.onPrimary,
                    fontWeight: '800',
                  }}
                >
                  {mode === 'pickup' ? t.pickup : t.delivery}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Photos des produits mis en avant par la marque, pour tous les visiteurs. */}
        <FeaturedProducts />

        {club ? (
          <>
            <View style={styles.rowTitle}>
              <Text style={[styles.h2, titleStyle(style), { color: palette.text }]}>
                {t.rewardsTitle}
              </Text>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.navigate('/avantages')}
                style={styles.link}
              >
                <Text style={{ color: palette.accent, fontWeight: '700' }}>
                  {messages.tabs.rewards} →
                </Text>
              </Pressable>
            </View>
            <View style={styles.grid}>
              {club.rewards.slice(0, 2).map((r) => (
                <Pressable
                  key={r.id}
                  accessibilityRole="link"
                  onPress={() => router.navigate('/avantages')}
                  style={[
                    styles.tile,
                    { backgroundColor: palette.surface, borderRadius: radii.card },
                  ]}
                >
                  {(() => {
                    const photo =
                      tierProducts(r, catalog).find((p) => p.imageUrl)?.imageUrl ?? null;
                    return photo ? (
                      <Image
                        source={{ uri: photo }}
                        style={[styles.tilePhoto, { borderRadius: radii.card - 4 }]}
                        contentFit="cover"
                        accessibilityIgnoresInvertColors
                      />
                    ) : null;
                  })()}
                  <Text style={[styles.tileName, titleStyle(style), { color: palette.text }]}>
                    {r.name}
                  </Text>
                  <Text style={{ color: palette.textMuted, fontSize: 13 }}>
                    {t.rewardCost(r.costPoints)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {club ? (
          member ? (
            <FidelityCard
              member={member}
              rewards={club.rewards}
              pointsPerEuro={club.pointsPerEuro}
            />
          ) : (
            <JoinCard welcomePoints={club.welcomePoints} />
          )
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 32 },
  hero: { alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingBottom: 10 },
  brandName: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  content: {
    padding: 16,
    paddingTop: 12,
    gap: 14,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  order: { padding: 18, gap: 8 },
  orderTitle: { fontSize: 24, fontWeight: '900' },
  orderButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  orderButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  rowTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h2: { fontSize: 20, fontWeight: '800' },
  link: { minHeight: 44, justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, padding: 10, gap: 4 },
  tilePhoto: { width: '100%', aspectRatio: 4 / 3, marginBottom: 4 },
  tileName: { fontSize: 17, fontWeight: '800' },
});
