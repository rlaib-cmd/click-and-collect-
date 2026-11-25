import type { LoyaltyMemberDto, LoyaltyRewardDto } from '@splash360/contracts';
import { nextReward } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCart } from '@/cart/CartProvider';
import { usablePoints } from '@/loyalty/points';
import { tierProducts, useRewardCatalog } from '@/loyalty/rewards';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { Icon } from './icons';

const t = messages.loyalty;

/**
 * « Ma fidélité » (lot 11) : solde, prochain cadeau avec sa photo, points manquants,
 * jauge et raccourci vers la commande ; ouvre la carte à scanner.
 */
export function FidelityCard({
  member,
  rewards,
  pointsPerEuro,
}: {
  member: LoyaltyMemberDto;
  rewards: readonly LoyaltyRewardDto[];
  pointsPerEuro: number;
}) {
  const { palette, radii, style } = useTenant();
  const { cart } = useCart();
  const catalog = useRewardCatalog(cart);
  const usable = usablePoints(member);
  const next = nextReward(rewards, usable);
  const tier = next?.reward ?? null;
  const image = tier
    ? (tierProducts(tier, catalog).find((p) => p.imageUrl)?.imageUrl ?? null)
    : null;
  const progress = tier ? Math.min(1, usable / tier.costPoints) : 1;
  return (
    <View
      style={[
        styles.fidelity,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderRadius: radii.card + 8,
        },
      ]}
    >
      <View style={styles.fidelityHead}>
        <View style={styles.flex}>
          <Text style={[styles.fidelityTitle, titleStyle(style), { color: palette.text }]}>
            {t.myLoyalty}
          </Text>
          <Text style={{ color: palette.textMuted, fontSize: 13 }}>{t.perEuro(pointsPerEuro)}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: palette.surface }]}>
          <View style={[styles.star, { backgroundColor: palette.loyalty }]}>
            <Icon name="star" color={palette.onLoyalty} size={16} />
          </View>
          <Text style={[styles.pillText, { color: palette.text }]}>{member.points}</Text>
          <Text style={{ color: palette.textMuted, fontWeight: '700' }}>pts</Text>
        </View>
      </View>
      <View
        style={[styles.nextBox, { backgroundColor: palette.surface, borderRadius: radii.card }]}
      >
        <View style={styles.nextRow}>
          {image ? (
            <Image
              source={{ uri: image }}
              style={styles.nextImage}
              contentFit="contain"
              accessibilityIgnoresInvertColors
            />
          ) : null}
          <View style={styles.flex}>
            {tier && next ? (
              <>
                <Text style={{ color: palette.loyalty, fontWeight: '800', fontSize: 12 }}>
                  {t.points(tier.costPoints)}
                </Text>
                <Text style={{ color: palette.text, fontSize: 15 }}>
                  {t.unlockPrefix(next.missingPoints)}{' '}
                  <Text style={{ fontWeight: '800' }}>{tier.name}</Text> !
                </Text>
              </>
            ) : (
              <Text style={{ color: palette.text, fontSize: 15, fontWeight: '800' }}>
                {t.allUnlocked}
              </Text>
            )}
          </View>
        </View>
        <View style={[styles.track, { backgroundColor: palette.border }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: palette.loyalty },
            ]}
          />
        </View>
        {member.reservedPoints > 0 ? (
          <Text style={{ color: palette.textMuted, fontSize: 12 }}>
            {t.reserved(member.reservedPoints)}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate(tier ? '/commander' : '/avantages')}
          style={styles.linkRow}
        >
          <Text style={{ color: palette.loyalty, fontWeight: '800' }}>
            {tier ? t.keepShopping : t.chooseGift} ›
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t.showCard}
        onPress={() => router.navigate('/carte')}
        style={styles.cardLink}
      >
        <Icon name="qr" color={palette.loyalty} size={20} />
        <Text style={{ color: palette.loyalty, fontWeight: '800' }}>{t.seeCard} ›</Text>
      </Pressable>
    </View>
  );
}

/** Invitation à rejoindre le club, pour un visiteur sans compte. */
export function JoinCard({ welcomePoints }: { welcomePoints: number }) {
  const { palette, radii, style } = useTenant();
  return (
    <View style={[styles.join, { backgroundColor: palette.text, borderRadius: radii.card + 6 }]}>
      <Text style={[styles.points, titleStyle(style), { color: palette.background }]}>
        {welcomePoints}
      </Text>
      <Text style={[styles.joinLabel, titleStyle(style), { color: palette.background }]}>
        {t.welcomePoints(welcomePoints).replace(`${welcomePoints} `, '')}
      </Text>
      <Text style={{ color: palette.background, fontSize: 14 }}>{t.welcomeHint}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/carte')}
        style={[
          styles.joinButton,
          { backgroundColor: palette.loyalty, borderRadius: radii.button },
        ]}
      >
        <Text style={{ color: palette.onLoyalty, fontWeight: '800' }}>{t.join} →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fidelity: {
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  fidelityHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fidelityTitle: { fontSize: 22, fontWeight: '900' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
  },
  star: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 20, fontWeight: '900' },
  nextBox: { padding: 14, gap: 10 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextImage: { width: 64, height: 64 },
  linkRow: { minHeight: 32, justifyContent: 'center' },
  cardLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    minHeight: 32,
  },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18 },
  cardText: { flex: 1, gap: 6 },
  points: { fontSize: 40, fontWeight: '900', lineHeight: 44 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 4 },
  fill: { height: 8 },
  qr: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  join: { padding: 18, gap: 6 },
  joinLabel: { fontSize: 16, fontWeight: '800' },
  joinButton: { marginTop: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
