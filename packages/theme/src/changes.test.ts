import { describe, expect, it } from 'vitest';
import { themeChanges } from './changes';
import { DEFAULT_STYLE, type TenantTheme } from './theme';

const live: TenantTheme = {
  primaryColor: '#CF2028',
  mode: 'light',
  logoUrl: 'https://exemple.fr/logo.png',
  tagline: 'Le smash',
  style: DEFAULT_STYLE,
  loyaltyColor: null,
};

describe('themeChanges', () => {
  it('ne voit aucun changement entre deux designs identiques', () => {
    expect(themeChanges(live, { ...live })).toEqual([]);
  });

  it('ignore la casse des couleurs et les espaces du slogan', () => {
    expect(themeChanges(live, { ...live, primaryColor: '#cf2028', tagline: ' Le smash ' })).toEqual(
      [],
    );
  });

  it('traite un slogan vide comme aucun slogan', () => {
    expect(themeChanges({ ...live, tagline: null }, { ...live, tagline: '' })).toEqual([]);
  });

  it('liste les réglages modifiés dans l’ordre du formulaire', () => {
    expect(
      themeChanges(live, {
        ...live,
        logoUrl: 'https://exemple.fr/autre.png',
        loyaltyColor: '#1D4ED8',
        style: { ...DEFAULT_STYLE, corners: 'pill', pattern: 'checker' },
      }),
    ).toEqual(['logoUrl', 'loyaltyColor', 'corners', 'pattern']);
  });
});
