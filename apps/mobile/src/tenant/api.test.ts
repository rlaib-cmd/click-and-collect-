import { describe, expect, it } from 'vitest';
import { fetchTenantConfig, previewFromSearch } from './api';

const config = {
  tenant: { id: '00000000-0000-4000-8000-000000000001', name: 'Bella', subdomain: 'bella' },
  theme: {
    primaryColor: '#C8102E',
    mode: 'light',
    logoUrl: null,
    tagline: null,
    style: { header: 'brand', corners: 'pill', uppercaseTitles: true, pattern: 'checker' },
    loyaltyColor: '#F2B705',
  },
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('chargement de la configuration', () => {
  it('renvoie la configuration valide', async () => {
    expect(await fetchTenantConfig('http://api', 'bella', fakeFetch(200, config))).toEqual({
      ok: true,
      config,
    });
  });

  it('traduit les erreurs de l’API', async () => {
    expect(
      await fetchTenantConfig(
        'http://api',
        'x',
        fakeFetch(403, { error: { code: 'tenant_suspended', message: '' } }),
      ),
    ).toEqual({ ok: false, error: 'suspended' });
    expect(
      await fetchTenantConfig(
        'http://api',
        'x',
        fakeFetch(404, { error: { code: 'not_found', message: '' } }),
      ),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await fetchTenantConfig('http://api', 'x', fakeFetch(500, {}))).toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('traite une réponse hors contrat ou une coupure réseau comme une erreur réseau', async () => {
    expect(await fetchTenantConfig('http://api', 'x', fakeFetch(200, { foo: 1 }))).toEqual({
      ok: false,
      error: 'network',
    });
    const offline: typeof fetch = () => Promise.reject(new TypeError('offline'));
    expect(await fetchTenantConfig('http://api', 'x', offline)).toEqual({
      ok: false,
      error: 'network',
    });
  });
});

describe('aperçu du brouillon de design (lot 12)', () => {
  it('transmet le jeton d’aperçu au serveur', async () => {
    let url = '';
    const spy: typeof fetch = (input) => {
      url = String(input);
      return Promise.resolve(new Response(JSON.stringify({ ...config, preview: true })));
    };
    const res = await fetchTenantConfig('http://api', 'bella', spy, '123.abc_DEF-ghi');
    expect(url).toBe('http://api/v1/tenants/bella/config?preview=123.abc_DEF-ghi');
    expect(res).toEqual({ ok: true, config: { ...config, preview: true } });
  });

  it('lit le jeton dans l’adresse et ignore un jeton suspect', () => {
    expect(previewFromSearch('?enseigne=bella&preview=1795.abc-_')).toBe('1795.abc-_');
    expect(previewFromSearch('?preview=<script>')).toBeNull();
    expect(previewFromSearch('')).toBeNull();
  });
});
