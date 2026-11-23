import type { ProductDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { titleStyle } from '@/components/brand';
import { formatPrice } from '@/lib/format';
import { useTenant } from '@/tenant/TenantProvider';

/**
 * Carte produit façon borne : photo en haut sur fond blanc, nom, description courte, prix.
 * `footer` remplace le prix (cadeaux : « Choisir », points manquants).
 */
export function ProductCard({
  product,
  onPress,
  width,
  dimmed = false,
  footer,
  overlay,
  accessibilityLabel,
}: {
  product: Pick<ProductDto, 'name' | 'description' | 'priceCents' | 'imageUrl' | 'available'>;
  onPress?: () => void;
  width?: number;
  dimmed?: boolean;
  footer?: ReactNode;
  overlay?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { palette, radii, style } = useTenant();
  const unavailable = !product.available;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? `${product.name}, ${formatPrice(product.priceCents)}`
      }
      accessibilityState={{ disabled: unavailable || !onPress }}
      disabled={unavailable || !onPress}
      onPress={onPress}
      style={[
        styles.card,
        width ? { width } : styles.flex,
        {
          backgroundColor: palette.mode === 'dark' ? palette.surface : '#FFFFFF',
          borderRadius: radii.card + 4,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={[styles.photoBox, { opacity: dimmed || unavailable ? 0.4 : 1 }]}>
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={styles.photo}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.initial, { color: palette.border }]}>
            {product.name.charAt(0).toUpperCase()}
          </Text>
        )}
        {overlay ? <View style={styles.overlay}>{overlay}</View> : null}
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, titleStyle(style), { color: palette.text }]} numberOfLines={2}>
          {product.name}
        </Text>
        {product.description ? (
          <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <View style={styles.footer}>
          {footer ?? (
            <Text style={[styles.price, { color: palette.accent }]}>
              {unavailable ? messages.menu.unavailable : formatPrice(product.priceCents)}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  photoBox: { height: 130, alignItems: 'center', justifyContent: 'center', padding: 8 },
  photo: { width: '100%', height: '100%' },
  initial: { fontSize: 48, fontWeight: '900' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 4, flexGrow: 1 },
  name: { fontSize: 16, fontWeight: '800' },
  description: { fontSize: 12, lineHeight: 16 },
  footer: { marginTop: 'auto', paddingTop: 6 },
  price: { fontSize: 16, fontWeight: '800' },
});
