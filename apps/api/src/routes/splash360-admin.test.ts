import { describe, expect, it } from 'vitest';
import type { AppDeps } from '../app';
import {
  BELLA_ID,
  BELLA_RESTO,
  GREEN_ID,
  GREEN_RESTO,
  sessionToken,
  testSetup,
} from '../test-fixtures';

/** Lot 14 (ADR 0018) : branchement de la vraie caisse Splash360 par restaurant, au back-office. */
async function admin(
  setup: ReturnType<typeof testSetup>,
  path: string,
  init: { method?: string; body?: unknown; email?: string } = {},
) {
  return setup.app.request(`/v1/admin${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await sessionToken(init.email ?? 'gerant@bella.test')}`,
      'X-Tenant-Id': BELLA_ID,
      'Content-Type': 'application/json',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

const probe = (result: () => Promise<{ products: number; categories: number }>) =>
  ({ splash360: { probe: result } }) satisfies Partial<AppDeps>;

describe('caisse Splash360 au back-office', () => {
  it('montre l’état de chaque restaurant et si les identifiants sont posés', async () => {
    const res = await admin(testSetup(), '/restaurants');
    const body = (await res.json()) as {
      restaurants: { id: string; splash360Live: boolean }[];
      splash360Configured: boolean;
    };
    expect(body.splash360Configured).toBe(false);
    expect(body.restaurants.find((r) => r.id === BELLA_RESTO)?.splash360Live).toBe(false);
  });

  it('refuse de brancher sans identifiants serveur', async () => {
    const res = await admin(testSetup(), `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: true },
      email: 'admin@splash360.test',
    });
    expect(res.status).toBe(409);
  });

  it('branche puis débranche un restaurant, et trace l’action', async () => {
    const setup = testSetup(probe(() => Promise.resolve({ products: 3, categories: 1 })));
    const on = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: true },
      email: 'admin@splash360.test',
    });
    expect(on.status).toBe(204);
    expect((await setup.deps.restaurants.findById(BELLA_ID, BELLA_RESTO))?.splash360Live).toBe(
      true,
    );
    await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: false },
      email: 'admin@splash360.test',
    });
    expect((await setup.deps.restaurants.findById(BELLA_ID, BELLA_RESTO))?.splash360Live).toBe(
      false,
    );
    const actions = setup.admin.audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['splash360.connect', 'splash360.disconnect']));
  });

  it('ne branche les accès du serveur que sur un seul restaurant (un accès par restaurant)', async () => {
    const setup = testSetup(probe(() => Promise.resolve({ products: 3, categories: 1 })));
    expect(await setup.deps.restaurants.setSplash360Live(GREEN_ID, GREEN_RESTO, true)).toBe(true);
    const res = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: true },
      email: 'admin@splash360.test',
    });
    expect(res.status).toBe(409);
    expect((await setup.deps.restaurants.findById(BELLA_ID, BELLA_RESTO))?.splash360Live).toBe(
      false,
    );
    expect(await setup.deps.restaurants.setSplash360Live(GREEN_ID, GREEN_RESTO, false)).toBe(true);
    expect(await setup.deps.restaurants.setSplash360Live(BELLA_ID, BELLA_RESTO, true)).toBe(true);
  });

  it('réserve le branchement au super-administrateur (audit M3), pas au propriétaire', async () => {
    const setup = testSetup(probe(() => Promise.resolve({ products: 3, categories: 1 })));
    for (const email of ['manager@bella.test', 'gerant@bella.test']) {
      const res = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
        method: 'POST',
        body: { live: true },
        email,
      });
      expect(res.status).toBe(403);
    }
  });

  it('teste la connexion et rapporte le résultat ou l’erreur', async () => {
    const ok = testSetup(probe(() => Promise.resolve({ products: 42, categories: 6 })));
    expect(
      await (
        await admin(ok, `/restaurants/${BELLA_RESTO}/splash360/test`, { method: 'POST' })
      ).json(),
    ).toEqual({ ok: true, products: 42, categories: 6 });

    const ko = testSetup(
      probe(() => Promise.reject(new Error('Jeton Splash360 refusé (HTTP 400)'))),
    );
    expect(
      await (
        await admin(ko, `/restaurants/${BELLA_RESTO}/splash360/test`, { method: 'POST' })
      ).json(),
    ).toEqual({ ok: false, message: 'Connexion à Splash360 impossible' });

    expect(
      await (
        await admin(testSetup(), `/restaurants/${BELLA_RESTO}/splash360/test`, { method: 'POST' })
      ).json(),
    ).toEqual({ ok: false, message: 'Identifiants Splash360 absents du serveur' });
  });
});

describe('diagnostic Splash360 réservé au super-administrateur (lot 19)', () => {
  const raw = (rawSales: (date: string) => Promise<unknown>) =>
    ({
      splash360: {
        probe: () => Promise.resolve({ products: 0, categories: 0 }),
        rawMenu: () => Promise.resolve({ produits: [] }),
        rawSales,
      },
    }) satisfies Partial<AppDeps>;

  it('refuse la carte et les ventes brutes à un gérant', async () => {
    const setup = testSetup(raw(() => Promise.resolve([])));
    for (const path of ['menu-raw', 'sales-raw?date=2026-11-25']) {
      const res = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360/${path}`);
      expect(res.status).toBe(403);
    }
  });

  it('renvoie quelques ventes brutes d’une journée, sans cache', async () => {
    const dates: string[] = [];
    const setup = testSetup(
      raw((date) => {
        dates.push(date);
        return Promise.resolve({ orders: [{ id: 1 }] });
      }),
    );
    const res = await admin(
      setup,
      `/restaurants/${BELLA_RESTO}/splash360/sales-raw?date=2026-11-25`,
      {
        email: 'admin@splash360.test',
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ orders: [{ id: 1 }] });
    expect(dates).toEqual(['2026-11-25']);
    const bad = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360/sales-raw?date=25-11`, {
      email: 'admin@splash360.test',
    });
    expect(bad.status).toBe(400);
  });

  it('répond 429 avec Retry-After quand l’export a déjà été appelé dans la minute', async () => {
    const setup = testSetup(
      raw(() => Promise.reject(Object.assign(new Error('pause'), { retryAfterMs: 41_500 }))),
    );
    const res = await admin(
      setup,
      `/restaurants/${BELLA_RESTO}/splash360/sales-raw?date=2026-11-25`,
      {
        email: 'admin@splash360.test',
      },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });
});
