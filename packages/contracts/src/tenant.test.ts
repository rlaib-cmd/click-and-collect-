import { describe, expect, it } from 'vitest';
import { subdomainSchema, tenantConfigSchema } from './tenant';

const valid = {
  tenant: { id: '00000000-0000-4000-8000-000000000001', name: 'Pizzeria Bella', subdomain: 'bella' },
  theme: { primaryColor: '#C8102E', mode: 'light', logoUrl: 'https://cdn.example.com/l.png', tagline: null },
};

describe('contrat de configuration d’enseigne', () => {
  it('accepte une configuration valide', () => {
    expect(tenantConfigSchema.parse(valid)).toEqual(valid);
  });

  it('refuse un logo hors https et une couleur invalide', () => {
    expect(tenantConfigSchema.safeParse({ ...valid, theme: { ...valid.theme, logoUrl: 'http://x.fr/l.png' } }).success).toBe(false);
    expect(tenantConfigSchema.safeParse({ ...valid, theme: { ...valid.theme, primaryColor: 'red' } }).success).toBe(false);
  });

  it('applique la règle des sous-domaines', () => {
    expect(subdomainSchema.safeParse('green-bowl').success).toBe(true);
    for (const bad of ['Bella', '-bella', 'bella-', 'be_lla', '']) {
      expect(subdomainSchema.safeParse(bad).success).toBe(false);
    }
  });
});
