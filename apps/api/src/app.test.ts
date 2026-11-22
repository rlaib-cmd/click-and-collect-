import { tenantConfigSchema } from '@splash360/contracts';
import { createMemoryTenantStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp({
  tenants: createMemoryTenantStore([
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Pizzeria Bella',
      subdomain: 'bella',
      status: 'active',
      theme: { primaryColor: '#C8102E', mode: 'light', logoUrl: null, tagline: 'Napolitaine' },
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Sans thème',
      subdomain: 'sans-theme',
      status: 'active',
      theme: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Suspendue',
      subdomain: 'suspendue',
      status: 'suspended',
      theme: null,
    },
  ]),
});

describe('GET /health', () => {
  it('répond ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /v1/tenants/:subdomain/config', () => {
  it('renvoie la configuration conforme au contrat, avec cache', async () => {
    const res = await app.request('/v1/tenants/bella/config');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=60');
    const body = tenantConfigSchema.parse(await res.json());
    expect(body.tenant.name).toBe('Pizzeria Bella');
    expect(body.theme.primaryColor).toBe('#C8102E');
  });

  it("applique le thème par défaut si l'enseigne n'en a pas", async () => {
    const body = tenantConfigSchema.parse(
      await (await app.request('/v1/tenants/sans-theme/config')).json(),
    );
    expect(body.theme.primaryColor).toBe('#1F6FEB');
  });

  it('refuse une enseigne suspendue (403) ou inconnue (404)', async () => {
    const suspended = await app.request('/v1/tenants/suspendue/config');
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toMatchObject({ error: { code: 'tenant_suspended' } });
    expect((await app.request('/v1/tenants/inconnue/config')).status).toBe(404);
  });

  it('refuse un sous-domaine mal formé (400)', async () => {
    expect((await app.request('/v1/tenants/Pas_Valide/config')).status).toBe(400);
  });

  it("autorise l'appel depuis le navigateur (CORS)", async () => {
    const res = await app.request('/v1/tenants/bella/config', {
      headers: { Origin: 'https://bella.example.fr' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('routes inconnues', () => {
  it('renvoie une erreur au format de l’API', async () => {
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
