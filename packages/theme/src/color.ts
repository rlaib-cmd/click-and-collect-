/** Couleurs hexadécimales #RRGGBB et contraste WCAG 2.x. */

export type HexColor = `#${string}`;

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): value is HexColor {
  return HEX.test(value);
}

export function parseHex(value: string): { r: number; g: number; b: number } {
  const match = HEX.exec(value);
  if (!match?.[1]) {
    throw new TypeError(`Couleur invalide : « ${value} » (format attendu #RRGGBB)`);
  }
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG (0 = noir, 1 = blanc). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseHex(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapport de contraste WCAG entre deux couleurs (de 1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const BLACK = '#000000' as const;
export const WHITE = '#FFFFFF' as const;

/** Texte à poser sur un fond : noir ou blanc, celui qui contraste le plus. */
export function readableTextOn(background: string): typeof BLACK | typeof WHITE {
  return contrastRatio(background, BLACK) >= contrastRatio(background, WHITE) ? BLACK : WHITE;
}
