import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { useTenant } from '@/tenant/TenantProvider';

/**
 * Logo de l'enseigne ; monogramme à ses couleurs si le logo manque ou ne charge pas.
 * `wide` : logo horizontal (texte compris), sans cadre, pour les en-têtes aux couleurs de l'enseigne.
 */
export function TenantLogo({ size = 120, wide = false }: { size?: number; wide?: boolean }) {
  const { config, palette } = useTenant();
  const [failed, setFailed] = useState(false);
  const { name } = config.tenant;
  const box = { width: size, height: size, borderRadius: size / 5 };

  if (config.theme.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: config.theme.logoUrl }}
        style={wide ? { width: size * 3.3, height: size } : box}
        contentFit="contain"
        accessibilityLabel={messages.app.logoAlt(name)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[styles.monogram, box, { backgroundColor: palette.primary }]}
      accessibilityLabel={messages.app.logoAlt(name)}
      accessibilityRole="image"
    >
      <Text style={[styles.letter, { color: palette.onPrimary, fontSize: size * 0.45 }]}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  monogram: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontWeight: '800' },
});
