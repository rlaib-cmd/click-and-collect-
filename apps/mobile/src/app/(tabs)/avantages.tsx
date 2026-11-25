import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckerBand, titleStyle } from '@/components/brand';
import { AmbassadorCard } from '@/components/AmbassadorCard';
import { Icon } from '@/components/icons';
import { FidelityCard } from '@/components/loyalty';
import { ProductCard } from '@/components/ProductCard';
import { TenantLogo } from '@/components/TenantLogo';
import { Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { usablePoints } from '@/loyalty/points';
import { takeReward, tierProducts, useRewardCatalog } from '@/loyalty/rewards';
import { useCart } from '@/cart/CartProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.loyalty;

/** Avantages : récompenses du club, solde et historique. */
export default function RewardsScreen() {
  const { palette, style, radii } = useTenant();
  const brand = style.header === 'brand';
  const { program, member } = useLoyalty();
  const { cart, dispatch } = useCart();
  const catalog = useRewardCatalog(cart);
  const insets = useSafeAreaInsets();
  if (!program) return <Loading />;
  if (!program.enabled) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.text }}>{t.noClub}</Text>
      </View>
    );
  }
  return (
    <ScrollView style={{ backgroundColor: palette.background }}>
      <View
        style={[
          styles.hero,
          { paddingTop: insets.top + 16 },
          brand
            ? { backgroundColor: palette.primary }
            : { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
        ]}
        accessible
        accessibilityRole="header"
        accessibilityLabel={program.name}
      >
        <Text
          style={[
            styles.clubWord,
            titleStyle(style),
            { color: brand ? palette.onPrimary : palette.text },
          ]}
        >
          {t.clubWord}
        </Text>
        <TenantLogo size={brand ? 52 : 64} wide={brand} />
      </View>
      {brand ? <CheckerBand /> : null}
      <View style={styles.content}>
        <Text style={{ color: palette.textMuted }}>{t.earnHint(program.pointsPerEuro)}</Text>
        <AmbassadorCard variant="rewards" />
        {member ? (
          <FidelityCard
            member={member}
            rewards={program.rewards}
            pointsPerEuro={program.pointsPerEuro}
          />
        ) : null}
        {[...program.rewards]
          .sort((x, y) => x.costPoints - y.costPoints)
          .map((r) => {
            const missing = member ? Math.max(0, r.costPoints - usablePoints(member)) : null;
            const locked = missing !== null && missing > 0;
            const items = tierProducts(r, catalog.products);
            return (
              <View key={r.id} style={styles.tier}>
                <View style={styles.tierHead}>
                  <View style={[styles.tierStar, { backgroundColor: palette.loyalty }]}>
                    <Icon name="star" color={palette.onLoyalty} size={14} />
                  </View>
                  <Text style={[styles.tierTitle, titleStyle(style), { color: palette.text }]}>
                    {t.tierTitle(r.costPoints)}
                  </Text>
                  <Text style={[styles.tierName, { color: palette.textMuted }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tierRow}
                >
                  {items.map((p) => (
                    <ProductCard
                      key={p.id}
                      width={156}
                      product={p}
                      dimmed={locked}
                      accessibilityLabel={
                        locked && missing !== null
                          ? `${p.name}, ${t.missingPoints(missing)}`
                          : `${p.name}, ${t.choose}`
                      }
                      overlay={
                        locked && missing !== null ? (
                          <>
                            <Icon name="lock" color={palette.text} size={26} />
                            <Text style={[styles.missing, { color: palette.text }]}>
                              {t.missingPoints(missing)}
                            </Text>
                          </>
                        ) : null
                      }
                      footer={
                        locked ? (
                          <Text style={{ color: palette.textMuted, fontWeight: '700' }}>
                            {t.points(r.costPoints)}
                          </Text>
                        ) : (
                          <View
                            style={[
                              styles.choose,
                              { backgroundColor: palette.loyalty, borderRadius: radii.button },
                            ]}
                          >
                            <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>
                              {member ? t.choose : t.join}
                            </Text>
                          </View>
                        )
                      }
                      onPress={
                        locked
                          ? undefined
                          : () =>
                              member
                                ? takeReward({
                                    rewardId: r.id,
                                    product: p,
                                    restaurantId: catalog.restaurantId,
                                    cart,
                                    dispatch,
                                    then: '/cart',
                                  })
                                : router.navigate('/carte')
                      }
                    />
                  ))}
                </ScrollView>
              </View>
            );
          })}
        {member ? (
          <View style={styles.list}>
            <Text style={[styles.h2, titleStyle(style), { color: palette.text }]}>{t.history}</Text>
            {member.history.length === 0 ? (
              <Text style={{ color: palette.textMuted }}>{t.noHistory}</Text>
            ) : null}
            {member.history.map((h, i) => (
              <View key={`${h.at}-${i}`} style={[styles.move, { borderColor: palette.border }]}>
                <View style={styles.moveText}>
                  <Text style={{ color: palette.text, fontWeight: '600' }}>{h.label}</Text>
                  <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                    {new Date(h.at).toLocaleDateString('fr-FR')} · {t.movement[h.kind]}
                  </Text>
                </View>
                <Text
                  style={{ color: h.points > 0 ? palette.accent : palette.text, fontWeight: '800' }}
                >
                  {h.points > 0 ? '+' : ''}
                  {h.points}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: {
    padding: 16,
    gap: 14,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 32,
  },
  hero: { alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 20 },
  clubWord: { fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  h2: { fontSize: 20, fontWeight: '800' },
  list: { gap: 10 },
  tier: { gap: 10 },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierStar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierTitle: { fontSize: 20, fontWeight: '900' },
  tierName: { flex: 1, fontSize: 13 },
  tierRow: { gap: 12, paddingRight: 16, paddingBottom: 4 },
  missing: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  choose: { alignItems: 'center', paddingVertical: 8 },
  move: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveText: { flex: 1, gap: 2 },
});
