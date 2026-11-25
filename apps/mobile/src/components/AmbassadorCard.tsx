import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAmbassador } from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

/**
 * Entrée vers le parcours Ambassadeur (lots 15 et 17) : une seule carte, aux couleurs de
 * l'enseigne (« Tag en Story … et gagne … points ;) »), sur l'accueil et dans Avantages.
 * Rien n'est affiché si l'enseigne n'a pas activé la fonction.
 */
export function AmbassadorCard() {
  const { config, palette, style, radii } = useTenant();
  const program = useAmbassador();
  if (!program.data?.enabled) return null;
  const title = t.rewardsEntry(config.tenant.name, program.data.bonusPoints);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.navigate('/ambassadeur')}
      style={[
        styles.card,
        {
          backgroundColor: palette.text,
          borderColor: palette.text,
          borderRadius: radii.card + 6,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.background }]}>
        <Icon name="star" color={palette.primary} size={22} />
      </View>
      <Text style={[styles.title, titleStyle(style), { color: palette.background, flex: 1 }]}>
        {title}
      </Text>
      <Text style={{ color: palette.background, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: 1 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
});
