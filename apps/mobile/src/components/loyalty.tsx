import type { LoyaltyMemberDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTenant } from '@/tenant/TenantProvider';
import { titleStyle } from './brand';
import { Icon } from './icons';

const t = messages.loyalty;

/** Solde de points et progression vers la prochaine récompense ; ouvre la carte à scanner. */
export function PointsCard({ member }: { member: LoyaltyMemberDto }) {
  const { palette, radii, style } = useTenant();
  const next = member.nextReward;
  const progress = next ? Math.min(1, member.points / next.costPoints) : 1;
  return (
    <View style={[styles.card, { backgroundColor: palette.text, borderRadius: radii.card + 6 }]}>
      <View style={styles.cardText}>
        <Text style={[styles.points, titleStyle(style), { color: palette.background }]}>
          {t.points(member.points)}
        </Text>
        <Text style={{ color: palette.background, fontWeight: '600', fontSize: 13 }}>
          {next ? t.nextReward(next.missingPoints, next.name) : t.allRewards}
        </Text>
        <View style={[styles.track, { backgroundColor: palette.textMuted }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: palette.loyalty },
            ]}
          />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.showCard}
        onPress={() => router.navigate('/carte')}
        style={[styles.qr, { backgroundColor: palette.loyalty, borderRadius: radii.card }]}
      >
        <Icon name="qr" color={palette.onLoyalty} size={30} />
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
