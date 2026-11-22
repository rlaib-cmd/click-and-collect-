import { describe, expect, it } from 'vitest';
import { resolveSubdomain } from './resolve';

describe("résolution de l'enseigne", () => {
  it('mobile : prend la variable de build', () => {
    expect(
      resolveSubdomain({ platform: 'native', buildTenant: 'bella', allowOverride: false }),
    ).toBe('bella');
    expect(
      resolveSubdomain({ platform: 'native', buildTenant: undefined, allowOverride: false }),
    ).toBeNull();
  });

  it('web : prend le sous-domaine', () => {
    expect(
      resolveSubdomain({
        platform: 'web',
        buildTenant: undefined,
        hostname: 'greenbowl.commande.fr',
        allowOverride: false,
      }),
    ).toBe('greenbowl');
  });

  it('web : ignore www, les IP et localhost, puis se rabat sur la variable de build', () => {
    for (const hostname of ['www.commande.fr', '127.0.0.1', 'localhost', 'commande.fr']) {
      expect(
        resolveSubdomain({ platform: 'web', buildTenant: 'bella', hostname, allowOverride: false }),
      ).toBe('bella');
    }
  });

  it('web : ?enseigne= ne fonctionne que hors production', () => {
    const base = {
      platform: 'web' as const,
      buildTenant: 'bella',
      hostname: 'localhost',
      search: '?enseigne=greenbowl',
    };
    expect(resolveSubdomain({ ...base, allowOverride: true })).toBe('greenbowl');
    expect(resolveSubdomain({ ...base, allowOverride: false })).toBe('bella');
  });

  it('rejette une valeur mal formée', () => {
    expect(
      resolveSubdomain({ platform: 'native', buildTenant: 'Bella Pizza!', allowOverride: false }),
    ).toBeNull();
  });
});
