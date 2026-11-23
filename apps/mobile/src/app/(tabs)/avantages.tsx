import { messages } from '@splash360/i18n';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckerBand, titleStyle } from '@/components/brand';
import { PointsCard } from '@/components/loyalty';
import { TenantLogo } from '@/components/TenantLogo';
import { Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { usablePoints } from '@/loyalty/points';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.loyalty;

/** Avantages : récompenses du club, solde et historique. */
export default function RewardsScreen() {
  const { palette, style, radii } = useTenant();
  const brand = style.header === 'brand';
  const { program, member } = useLoyalty();
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
        {member ? <PointsCard member={member} /> : null}
        <View style={styles.list}>
          {program.rewards.map((r) => {
            const missing = member ? Math.max(0, r.costPoints - usablePoints(member)) : null;
            // Récompense à portée (ou visiteur) : couleur du club ; sinon tuile sombre et jauge.
            const locked = missing !== null && missing > 0;
            const bg = locked ? palette.text : palette.loyalty;
            const fg = locked ? palette.background : palette.onLoyalty;
            const progress = member ? Math.min(1, usablePoints(member) / r.costPoints) : 0;
            return (
              <View
                key={r.id}
                style={[styles.reward, { backgroundColor: bg, borderRadius: radii.card + 4 }]}
              >
                <View style={styles.rewardHead}>
                  <Text style={[styles.name, titleStyle(style), { color: fg }]}>{r.name}</Text>
                  <Text style={[styles.cost, titleStyle(style), { color: fg }]}>
                    {t.points(r.costPoints)}
                  </Text>
                </View>
                {missing === 0 ? (
                  <View style={[styles.badge, { backgroundColor: palette.onLoyalty }]}>
                    <Text style={[styles.badgeText, { color: palette.loyalty }]}>
                      {t.availableBadge}
                    </Text>
                  </View>
                ) : locked ? (
                  <View style={styles.lockedRow}>
                    <View style={[styles.track, { backgroundColor: palette.textMuted }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.round(progress * 100)}%`,
                            backgroundColor: palette.loyalty,
                          },
                        ]}
                      />
                    </View>
                    <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>
                      {t.rewardTooExpensive(missing)}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
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
  reward: { padding: 18, gap: 12, minHeight: 72, justifyContent: 'center' },
  rewardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: { fontSize: 20, fontWeight: '900', flex: 1 },
  cost: { fontSize: 18, fontWeight: '900' },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  lockedRow: { gap: 6 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  move: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveText: { flex: 1, gap: 2 },
});
