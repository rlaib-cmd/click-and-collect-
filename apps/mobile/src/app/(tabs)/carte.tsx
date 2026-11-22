import { messages } from '@splash360/i18n';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
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
            <Text style={[styles.club, titleStyle(style), { color: palette.onPrimary }]}>
              {config.tenant.name}
            </Text>
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
  club: { fontSize: 20, fontWeight: '900' },
  qrBox: { backgroundColor: '#FFFFFF', padding: 14, borderRadius: 16 },
  points: { fontSize: 32, fontWeight: '900' },
});
