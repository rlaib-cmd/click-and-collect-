import { messages } from '@splash360/i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/icons';
import { useTenant } from '@/tenant/TenantProvider';

export type PayMethod = 'online' | 'on_site';

/**
 * Choix du moyen de paiement : deux grandes cartes côte à côte (carte bancaire / sur place).
 * Le paiement par carte lui-même (Apple Pay, Google Pay ou saisie de la carte) s'ouvre ensuite,
 * une fois la commande acceptée par la caisse (ADR 0018).
 */
export function PaymentMethodCards({
  online,
  onSite,
  onSiteLocked,
  selected,
  onSelect,
}: {
  online: boolean;
  onSite: boolean;
  /** Sur place réservé aux membres : le client n'est pas connecté au club. */
  onSiteLocked: boolean;
  selected: PayMethod;
  onSelect: (m: PayMethod) => void;
}) {
  const options: { id: PayMethod; icon: IconName; label: string; hint: string }[] = [];
  if (online)
    options.push({
      id: 'online',
      icon: 'card',
      label: messages.pay.online,
      hint: messages.pay.onlineHint,
    });
  if (onSite)
    options.push({
      id: 'on_site',
      icon: 'store',
      label: messages.pay.onSite,
      hint: onSiteLocked ? messages.pay.onSiteLocked : messages.pay.onSiteShort,
    });
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {options.map((o) => (
        <MethodCard key={o.id} {...o} selected={selected === o.id} onPress={() => onSelect(o.id)} />
      ))}
    </View>
  );
}

function MethodCard({
  icon,
  label,
  hint,
  selected,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette, radii } = useTenant();
  const fg = selected ? palette.onPrimary : palette.text;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: selected ? palette.primary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
          borderRadius: radii.card,
        },
      ]}
    >
      <Icon name={icon} color={fg} size={28} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
      <Text style={[styles.hint, { color: selected ? palette.onPrimary : palette.textMuted }]}>
        {hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  card: {
    flex: 1,
    minHeight: 112,
    padding: 14,
    borderWidth: 2,
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: { fontWeight: '800', fontSize: 16, textAlign: 'center' },
  hint: { fontSize: 12, textAlign: 'center' },
});
