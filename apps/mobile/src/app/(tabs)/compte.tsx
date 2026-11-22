import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { JoinForm } from '@/components/JoinForm';
import { PrimaryButton } from '@/components/ui';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.loyalty;

/** Compte : profil du membre, déconnexion, conditions générales. */
export default function AccountScreen() {
  const { palette, style, radii } = useTenant();
  const { enabled, member, logout } = useLoyalty();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.account}
      </Text>
      {member ? (
        <View style={[styles.box, { backgroundColor: palette.surface, borderRadius: radii.card }]}>
          <Text style={{ color: palette.text, fontSize: 18, fontWeight: '700' }}>
            {member.name}
          </Text>
          <Text style={{ color: palette.textMuted }}>{member.email}</Text>
          <Text style={{ color: palette.text, fontWeight: '700' }}>
            {t.pointsLong(member.points)}
          </Text>
        </View>
      ) : enabled ? (
        <JoinForm />
      ) : null}
      <PrimaryButton label={t.myOrders} onPress={() => router.navigate('/commander')} />
      <Pressable accessibilityRole="link" onPress={() => router.push('/legal')} style={styles.row}>
        <Text style={{ color: palette.accent, fontWeight: '600' }}>{t.legal}</Text>
      </Pressable>
      {member ? (
        <Pressable accessibilityRole="button" onPress={logout} style={styles.row}>
          <Text style={{ color: palette.textMuted, fontWeight: '600' }}>{t.logout}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 16,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 32,
  },
  h1: { fontSize: 28, fontWeight: '900' },
  box: { padding: 16, gap: 6 },
  row: { minHeight: 44, justifyContent: 'center' },
});
