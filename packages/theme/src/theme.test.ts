import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor, parseHex, readableTextOn, relativeLuminance } from './color';
import { buildPalette, DEFAULT_STYLE, DEFAULT_THEME, MIN_UI_CONTRAST, radiiFor } from './theme';

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
    for (const color of [
      '#C8102E',
      '#A3E635',
      '#FFEB3B',
      '#1F6FEB',
      '#777777',
      '#000000',
      '#FFFFFF',
    ]) {
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
    expect(contrastRatio(redOnWhite.accent, redOnWhite.background)).toBeGreaterThanOrEqual(
      MIN_UI_CONTRAST,
    );
  });
});

describe('style', () => {
  it('par défaut : en-tête simple, angles arrondis, sans motif', () => {
    expect(DEFAULT_THEME.style).toEqual(DEFAULT_STYLE);
    expect(DEFAULT_STYLE).toEqual({
      header: 'plain',
      corners: 'rounded',
      uppercaseTitles: false,
      pattern: 'none',
    });
  });

  it('donne des rayons cohérents pour chaque forme', () => {
    expect(radiiFor('pill').button).toBeGreaterThan(radiiFor('rounded').button);
    expect(radiiFor('square')).toEqual({ button: 2, card: 2, chip: 2 });
    expect(radiiFor('rounded')).toEqual({ button: 12, card: 12, chip: 22 });
  });

  it('Bills Burger (#CF2028) : texte blanc lisible sur la couleur', () => {
    const p = buildPalette({ primaryColor: '#CF2028', mode: 'light' });
    expect(p.onPrimary).toBe('#FFFFFF');
    expect(contrastRatio(p.primary, p.onPrimary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('couleur du club fidélité', () => {
  it("reprend la couleur de l'enseigne quand aucune n'est choisie", () => {
    const p = buildPalette({ primaryColor: '#CF2028', mode: 'light', loyaltyColor: null });
    expect(p.loyalty).toBe('#CF2028');
    expect(p.onLoyalty).toBe(p.onPrimary);
  });

  it('calcule un texte lisible sur la couleur du club', () => {
    const gold = buildPalette({ primaryColor: '#CF2028', mode: 'light', loyaltyColor: '#f2b705' });
    expect(gold.loyalty).toBe('#F2B705');
    expect(gold.onLoyalty).toBe('#000000');
    for (const color of ['#111111', '#F2B705', '#1F6FEB', '#A3E635']) {
      const p = buildPalette({ primaryColor: '#CF2028', mode: 'light', loyaltyColor: color });
      expect(contrastRatio(p.loyalty, p.onLoyalty)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
