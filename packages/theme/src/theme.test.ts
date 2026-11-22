import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, parseHex, readableTextOn, relativeLuminance } from './color';
import { buildPalette, MIN_UI_CONTRAST } from './theme';

describe('couleurs', () => {
  it('lit une couleur #RRGGBB', () => {
    expect(parseHex('#C8102E')).toEqual({ r: 200, g: 16, b: 46 });
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(() => parseHex('rouge')).toThrow(TypeError);
  });

  it('calcule la luminance et le contraste WCAG', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('choisit le texte noir ou blanc le plus lisible sur la couleur', () => {
    expect(readableTextOn('#C8102E')).toBe('#FFFFFF'); // rouge foncé
    expect(readableTextOn('#A3E635')).toBe('#000000'); // vert clair
    expect(readableTextOn('#FFEB3B')).toBe('#000000'); // jaune
    expect(readableTextOn('#1F6FEB')).toBe('#FFFFFF'); // bleu
  });
});

describe('palette', () => {
  it('le texte des boutons contraste toujours au moins à 4,5:1 (WCAG AA)', () => {
    for (const color of ['#C8102E', '#A3E635', '#FFEB3B', '#1F6FEB', '#777777', '#000000', '#FFFFFF']) {
      const palette = buildPalette({ primaryColor: color, mode: 'light' });
      expect(contrastRatio(palette.primary, palette.onPrimary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("remplace l'accent quand la couleur de l'enseigne se lit mal sur le fond", () => {
    const yellowOnWhite = buildPalette({ primaryColor: '#FFEB3B', mode: 'light' });
    expect(yellowOnWhite.accent).toBe('#000000');
    const redOnWhite = buildPalette({ primaryColor: '#c8102e', mode: 'light' });
    expect(redOnWhite.accent).toBe('#C8102E');
    const navyOnDark = buildPalette({ primaryColor: '#0B1F3A', mode: 'dark' });
    expect(navyOnDark.accent).toBe('#FFFFFF');
    expect(contrastRatio(redOnWhite.accent, redOnWhite.background)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });
});
