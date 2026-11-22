import { messages } from '@splash360/i18n';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { JoinForm } from '@/components/JoinForm';
import { Loading } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.loyalty;

/** Ma carte : QR code à scanner en caisse, ou adhésion au club. */
export default function CardScreen() {
  const { palette, style, radii, config } = useTenant();
  const { program, member, memberLoading } = useLoyalty();
  const insets = useSafeAreaInsets();
  if (!program || memberLoading) return <Loading />;
  if (!program.enabled) {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.text }}>{t.noClub}</Text>
      </View>
    );
  }
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
    >
      {member ? (
        <>
          <Text
            style={[styles.h1, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {t.cardTitle}
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: palette.primary, borderRadius: radii.card + 8 },
            ]}
          >
            <View style={styles.cardHead}>
              <Text style={[styles.club, titleStyle(style), { color: palette.onPrimary }]}>
                {config.tenant.name}
              </Text>
              <View style={[styles.vip, { backgroundColor: palette.onPrimary, borderRadius: 999 }]}>
                <Icon name="crown" color={palette.primary} size={16} />
                <Text style={[styles.vipText, titleStyle(style), { color: palette.primary }]}>
                  {t.vip}
                </Text>
              </View>
            </View>
            <Text style={{ color: palette.onPrimary, fontWeight: '700' }}>{member.name}</Text>
            <View style={styles.qrBox} accessibilityLabel={t.cardCode(member.cardCode)} accessible>
              <QRCode
                value={member.cardCode}
                size={220}
                backgroundColor="#FFFFFF"
                color="#000000"
              />
            </View>
            <Text style={{ color: palette.onPrimary, fontWeight: '700' }} selectable>
              {member.cardCode}
            </Text>
            <Text style={[styles.points, titleStyle(style), { color: palette.onPrimary }]}>
              {t.points(member.points)}
            </Text>
          </View>
          <Text style={{ color: palette.textMuted, textAlign: 'center' }}>{t.cardHint}</Text>
        </>
      ) : (
        <JoinForm />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: {
    padding: 16,
    gap: 16,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 32,
  },
  h1: { fontSize: 28, fontWeight: '900' },
  card: { alignItems: 'center', gap: 12, padding: 22 },
  cardHead: { alignItems: 'center', gap: 8 },
  club: { fontSize: 20, fontWeight: '900' },
  vip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  vipText: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  qrBox: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: 16 },
  points: { fontSize: 32, fontWeight: '900' },
});
