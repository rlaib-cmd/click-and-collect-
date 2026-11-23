import { messages } from '@splash360/i18n';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { BackButton } from '@/components/ui';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.account;

/**
 * Mes moyens de paiement (lot 11) : écran prêt, cartes enregistrées activées avec le paiement
 * en ligne Stripe (aucune donnée de carte dans l'application, règle non négociable).
 */
export default function PaymentMethodsScreen() {
  const { palette, style, radii } = useTenant();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.page, { backgroundColor: palette.background, paddingTop: insets.top + 8 }]}
    >
      <BackButton color={palette.accent} />
      <Text
        style={[styles.h1, titleStyle(style), { color: palette.text }]}
        accessibilityRole="header"
      >
        {t.payments}
      </Text>
      <View
        style={[styles.box, { backgroundColor: palette.surface, borderRadius: radii.card + 4 }]}
      >
        <View style={[styles.icon, { backgroundColor: palette.loyalty }]}>
          <Icon name="card" color={palette.onLoyalty} size={30} />
        </View>
        <Text style={[styles.title, { color: palette.text }]}>{t.paymentsSoonTitle}</Text>
        <Text style={{ color: palette.textMuted, textAlign: 'center', lineHeight: 20 }}>
          {t.paymentsSoon}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 16, gap: 16 },
  h1: { fontSize: 26, fontWeight: '900' },
  box: { alignItems: 'center', padding: 24, gap: 12 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
});
