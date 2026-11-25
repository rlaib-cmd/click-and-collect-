import { messages } from '@splash360/i18n';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAmbassador } from '@/api/hooks';
import { titleStyle } from '@/components/brand';
import { Icon } from '@/components/icons';
import { useTenant } from '@/tenant/TenantProvider';

const t = messages.ambassador;

/**
 * Entrée vers le parcours Ambassadeur (lot 15) : grande carte sur l'accueil, ligne compacte dans
 * Avantages. Rien n'est affiché si l'enseigne n'a pas activé la fonction.
 */
export function AmbassadorCard({ variant }: { variant: 'home' | 'rewards' }) {
  const { config, palette, style, radii } = useTenant();
  const program = useAmbassador();
  if (!program.data?.enabled) return null;
  const brand = config.tenant.name;
  const title =
    variant === 'home' ? t.cardTitle(brand) : t.rewardsEntry(brand, program.data.bonusPoints);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.navigate('/ambassadeur')}
      style={[
        styles.card,
        {
          backgroundColor: variant === 'home' ? palette.surface : palette.primary,
          borderColor: palette.border,
          borderRadius: radii.card + 6,
        },
      ]}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: variant === 'home' ? palette.primary : palette.onPrimary },
        ]}
      >
        <Icon
          name="star"
          color={variant === 'home' ? palette.onPrimary : palette.primary}
          size={22}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[
            styles.title,
            titleStyle(style),
            { color: variant === 'home' ? palette.text : palette.onPrimary },
          ]}
        >
          {title}
        </Text>
        {variant === 'home' ? <Text style={{ color: palette.textMuted }}>{t.cardHint}</Text> : null}
      </View>
      <Text
        style={{ color: variant === 'home' ? palette.accent : palette.onPrimary, fontSize: 20 }}
      >
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: 1 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
});
