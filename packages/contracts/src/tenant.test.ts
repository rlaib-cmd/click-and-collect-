import { describe, expect, it } from 'vitest';
import { subdomainSchema, tenantConfigSchema } from './tenant';

const valid = {
  tenant: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Pizzeria Bella',
    subdomain: 'bella',
  },
  theme: {
    primaryColor: '#C8102E',
    mode: 'light',
    logoUrl: 'https://cdn.example.com/l.png',
    tagline: null,
  },
};

describe('contrat de configuration d’enseigne', () => {
  it('accepte une configuration valide et complète le style par défaut', () => {
    expect(tenantConfigSchema.parse(valid)).toEqual({
      ...valid,
      theme: {
        ...valid.theme,
        style: { header: 'plain', corners: 'rounded', uppercaseTitles: false, pattern: 'none' },
        loyaltyColor: null,
      },
    });
  });

  it('accepte une couleur de club hexadécimale et refuse le reste', () => {
    const withColor = (loyaltyColor: unknown) =>
      tenantConfigSchema.safeParse({ ...valid, theme: { ...valid.theme, loyaltyColor } });
    expect(withColor('#F2B705').success).toBe(true);
    expect(withColor(null).success).toBe(true);
    expect(withColor('gold').success).toBe(false);
  });

  it('garde un style personnalisé et refuse une valeur inconnue', () => {
    const style = { header: 'brand', corners: 'pill', uppercaseTitles: true, pattern: 'checker' };
    expect(
      tenantConfigSchema.parse({ ...valid, theme: { ...valid.theme, style } }).theme.style,
    ).toEqual(style);
    expect(
      tenantConfigSchema.safeParse({
        ...valid,
        theme: { ...valid.theme, style: { ...style, corners: 'wavy' } },
      }).success,
    ).toBe(false);
  });

  it('refuse un logo hors https et une couleur invalide', () => {
    expect(
      tenantConfigSchema.safeParse({
        ...valid,
        theme: { ...valid.theme, logoUrl: 'http://x.fr/l.png' },
      }).success,
    ).toBe(false);
    expect(
      tenantConfigSchema.safeParse({ ...valid, theme: { ...valid.theme, primaryColor: 'red' } })
        .success,
    ).toBe(false);
  });

  it('applique la règle des sous-domaines', () => {
    expect(subdomainSchema.safeParse('green-bowl').success).toBe(true);
    for (const bad of ['Bella', '-bella', 'bella-', 'be_lla', '']) {
      expect(subdomainSchema.safeParse(bad).success).toBe(false);
    }
  });
});
