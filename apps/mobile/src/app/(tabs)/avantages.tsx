import { messages } from '@splash360/i18n';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckerBand, titleStyle } from '@/components/brand';
import { PointsCard } from '@/components/loyalty';
import { TenantLogo } from '@/components/TenantLogo';
import { Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
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
            const missing = member ? Math.max(0, r.costPoints - member.points) : null;
            return (
              <View
                key={r.id}
                style={[
                  styles.reward,
                  { backgroundColor: palette.surface, borderRadius: radii.card },
                ]}
              >
                <Text style={[styles.name, titleStyle(style), { color: palette.text }]}>
                  {r.name}
                </Text>
                <View style={styles.right}>
                  <Text style={{ color: palette.text, fontWeight: '700' }}>
                    {t.points(r.costPoints)}
                  </Text>
                  {missing === 0 ? (
                    <Text style={{ color: palette.accent, fontWeight: '700', fontSize: 12 }}>
                      {t.available}
                    </Text>
                  ) : missing !== null ? (
                    <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                      {t.rewardTooExpensive(missing)}
                    </Text>
                  ) : null}
                </View>
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
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    minHeight: 56,
  },
  name: { fontSize: 18, fontWeight: '800', flex: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
  move: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moveText: { flex: 1, gap: 2 },
});
