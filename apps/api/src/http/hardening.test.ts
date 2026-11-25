import { describe, expect, it } from 'vitest';
import { BELLA_RESTO, testApp, testSetup } from '../test-fixtures';

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

  it('plafonne les requêtes du back-office avant toute lecture en base', async () => {
    const app = testApp({ rateLimits: { orders: 3, reads: 1000, admin: 4 } });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await app.request('/v1/admin/restaurants')).status);
    expect(statuses.slice(0, 4).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(4)).toEqual([429, 429]);
  });

  it('fait patienter puis renvoie « rechargez » à un back-office obsolète, sans toucher la base', async () => {
    const setup = testSetup({ outdatedClientHoldMs: 0 });
    let reads = 0;
    setup.deps.restaurants.listByTenant = () => {
      reads += 1;
      return Promise.resolve([]);
    };
    // Requête brute, sans l'en-tête de version (ancien onglet).
    const raw = new Request('http://local/v1/admin/restaurants', {
      headers: { Authorization: 'Bearer x' },
    });
    const res = await setup.app.fetch(raw);
    expect(res.status).toBe(426);
    expect(reads).toBe(0);
    // Le préflight CORS reste servi normalement.
    const pre = await setup.app.fetch(
      new Request('http://local/v1/admin/restaurants', {
        method: 'OPTIONS',
        headers: { Origin: 'https://x.test', 'Access-Control-Request-Method': 'GET' },
      }),
    );
    expect(pre.status).toBe(204);
  });

  it('plafonne par adresse avant le garde « obsolète » et ne retient que 20 requêtes à la fois', async () => {
    // Plafond par adresse d'abord : la 4e requête obsolète est refusée tout de suite (429).
    const limited = testSetup({
      outdatedClientHoldMs: 0,
      rateLimits: { orders: 3, reads: 100, admin: 3 },
    });
    const codes = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (await limited.app.fetch(new Request('http://local/v1/admin/restaurants'))).status,
      );
    expect(codes).toEqual([426, 426, 426, 429]);

    // Au plus 20 requêtes retenues : les suivantes reçoivent 426 sans attendre.
    const setup = testSetup({ outdatedClientHoldMs: 300 });
    const started = Date.now();
    const durations = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const res = await setup.app.fetch(new Request('http://local/v1/admin/restaurants'));
        expect(res.status).toBe(426);
        return Date.now() - started;
      }),
    );
    expect(durations.filter((d) => d >= 250)).toHaveLength(20);
    expect(durations.filter((d) => d < 250)).toHaveLength(5);
  });

  it('compte les requêtes par adresse réelle, pas par un X-Forwarded-For forgé (audit M2)', async () => {
    const app = testSetup({
      trustProxy: true,
      clientIpHeader: 'cf-connecting-ip',
      rateLimits: { orders: 1, reads: 1000 },
    }).app;
    const order = (forged: string, real: string) =>
      app.request('/v1/tenants/bella/orders', {
        method: 'POST',
        headers: { ...json, 'X-Forwarded-For': `${forged}, 10.0.0.1`, 'cf-connecting-ip': real },
        body: '{}',
      });
    expect((await order('1.1.1.1', '203.0.113.7')).status).toBe(400);
    // Même client réel, autre adresse inventée : toujours limité.
    expect((await order('2.2.2.2', '203.0.113.7')).status).toBe(429);
    // Autre client réel : servi.
    expect((await order('2.2.2.2', '203.0.113.8')).status).toBe(400);
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
