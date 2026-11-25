import type { ThemeStyle } from '@splash360/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import { useTenant } from '@/tenant/TenantProvider';

/** Titres selon le style de l'enseigne (majuscules, graisse forte). */
export function titleStyle(style: ThemeStyle): TextStyle {
  return style.uppercaseTitles
    ? { textTransform: 'uppercase', fontWeight: '900', letterSpacing: 0.5 }
    : {};
}

const CHECKER_SIZE = 10;
const CHECKER_COLUMNS = 160;

/** Bande en damier aux couleurs de l'enseigne (motif `checker`) ; décorative. */
export function CheckerBand() {
  const { palette, style } = useTenant();
  if (style.pattern !== 'checker') return null;
  const row = (offset: number) => (
    <View style={styles.row}>
      {Array.from({ length: CHECKER_COLUMNS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.cell,
            { backgroundColor: (i + offset) % 2 === 0 ? palette.primary : palette.onPrimary },
          ]}
        />
      ))}
    </View>
  );
  return (
    <View
      style={styles.band}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {row(0)}
      {row(1)}
    </View>
  );
}

/**
 * Bandeau d'en-tête : sur la couleur de l'enseigne si `header` vaut `brand`,
 * sinon sur le fond de l'application avec un filet.
 */
export function BrandBar({ children, paddingTop }: { children: ReactNode; paddingTop: number }) {
  const { palette, style } = useTenant();
  const brand = style.header === 'brand';
  return (
    <View>
      <View
        style={[
          styles.bar,
          { paddingTop },
          brand
            ? { backgroundColor: palette.primary }
            : { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
        ]}
      >
        {children}
      </View>
      {brand ? <CheckerBand /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { overflow: 'hidden', alignSelf: 'stretch' },
  row: { flexDirection: 'row' },
  cell: { width: CHECKER_SIZE, height: CHECKER_SIZE },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
});
