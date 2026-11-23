import { formatFrenchPhone } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckerBand, titleStyle } from '@/components/brand';
import { Icon, type IconName } from '@/components/icons';
import { JoinForm } from '@/components/JoinForm';
import { TAB_BAR_CLEARANCE } from '@/components/layout';
import { TenantLogo } from '@/components/TenantLogo';
import { useLoyalty } from '@/loyalty/LoyaltyProvider';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.account;

/** Mon compte (lot 11) : profil et points, commandes, codes promo, moyens de paiement, aide. */
export default function AccountScreen() {
  const { palette, style, radii } = useTenant();
  const { enabled, member, logout } = useLoyalty();
  const insets = useSafeAreaInsets();
  const brand = style.header === 'brand';

  const rows: readonly { icon: IconName; title: string; hint: string; href: Href }[] = [
    { icon: 'receipt', title: t.orders, hint: t.ordersHint, href: '/mes-commandes' },
    { icon: 'tag', title: t.promos, hint: t.promosHint, href: '/mes-codes-promo' },
    { icon: 'card', title: t.payments, hint: t.paymentsHint, href: '/moyens-de-paiement' },
    { icon: 'help', title: t.info, hint: t.infoHint, href: '/legal' },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          styles.hero,
          { paddingTop: insets.top + 20 },
          brand
            ? { backgroundColor: palette.primary }
            : { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
        ]}
      >
        <TenantLogo size={brand ? 44 : 64} wide={brand} />
      </View>
      {brand ? <CheckerBand /> : null}

      <View style={styles.content}>
        {member ? (
          <View
            style={[
              styles.profile,
              {
                backgroundColor: palette.background,
                borderColor: palette.border,
                borderRadius: radii.card + 8,
              },
            ]}
          >
            <Text
              style={[styles.name, titleStyle(style), { color: palette.text }]}
              accessibilityRole="header"
            >
              {member.name}
            </Text>
            <Text style={{ color: palette.textMuted, textAlign: 'center' }}>
              {member.phone ? formatFrenchPhone(member.phone) : member.email}
            </Text>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <View style={styles.pointsRow}>
              <View style={[styles.star, { backgroundColor: palette.loyalty }]}>
                <Icon name="star" color={palette.onLoyalty} size={18} />
              </View>
              <Text style={[styles.points, { color: palette.loyalty }]}>
                {t.points(member.points)}
              </Text>
            </View>
          </View>
        ) : (
          <Text
            style={[styles.h1, titleStyle(style), { color: palette.text }]}
            accessibilityRole="header"
          >
            {t.title}
          </Text>
        )}
        {!member && enabled ? <JoinForm /> : null}

        <View>
          {rows
            .filter((r) => member !== null || r.href === '/legal')
            .map((r) => (
              <Pressable
                key={r.title}
                accessibilityRole="link"
                accessibilityLabel={`${r.title}, ${r.hint}`}
                onPress={() => router.push(r.href)}
                style={[styles.row, { borderColor: palette.border }]}
              >
                <Icon name={r.icon} color={palette.text} size={26} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: palette.text }]}>{r.title}</Text>
                  <Text style={{ color: palette.textMuted, fontSize: 13 }}>{r.hint}</Text>
                </View>
                <Icon name="chevron" color={palette.text} size={20} />
              </Pressable>
            ))}
        </View>

        {member ? (
          <Pressable accessibilityRole="button" onPress={logout} style={styles.logout}>
            <Icon name="logout" color={palette.loyalty} size={22} />
            <Text style={{ color: palette.loyalty, fontWeight: '800', fontSize: 17 }}>
              {t.logout}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 48 },
  content: {
    paddingHorizontal: 16,
    gap: 16,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  profile: {
    marginTop: -36,
    padding: 18,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  name: { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  pointsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  star: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  points: { fontSize: 24, fontWeight: '900' },
  h1: { fontSize: 28, fontWeight: '900', marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    marginTop: 8,
  },
});
