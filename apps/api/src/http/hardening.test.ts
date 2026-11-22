import { describe, expect, it } from 'vitest';
import { BELLA_RESTO, testApp } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };

describe('durcissement de l’API', () => {
  it('limite le nombre de créations de commande par minute et par adresse', async () => {
    const app = testApp({ rateLimits: { orders: 3, reads: 1000 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/v1/tenants/bella/orders', {
        method: 'POST',
        headers: json,
        body: '{}',
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([400, 400, 400, 429, 429]);
  });

  it('applique une limite plus large aux lectures publiques', async () => {
    const app = testApp({ rateLimits: { orders: 3, reads: 5 } });
    const statuses = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await app.request('/v1/tenants/bella/config')).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
  });

  it('refuse un corps de requête trop volumineux', async () => {
    const res = await testApp().request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/quote`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('renvoie un identifiant de requête et une sonde de disponibilité', async () => {
    const lines: unknown[] = [];
    const app = testApp({
      log: true,
      logger: (_l, m, d) => lines.push({ m, ...d }),
      ready: () => Promise.resolve(false),
    });
    const res = await app.request('/health', { headers: { 'x-request-id': 'demande-1234' } });
    expect(res.headers.get('x-request-id')).toBe('demande-1234');
    expect(lines[0]).toMatchObject({ requestId: 'demande-1234', path: '/health', status: 200 });
    expect((await app.request('/ready')).status).toBe(503);
  });

  it('ne journalise pas les paramètres de requête (recherche client, jetons)', async () => {
    const lines: { path?: string }[] = [];
    const app = testApp({ log: true, logger: (_l, _m, d) => lines.push(d ?? {}) });
    await app.request('/v1/tenants/bella/geo/search?q=12 rue secrète');
    expect(lines[0]?.path).toBe('/v1/tenants/bella/geo/search');
  });
});
