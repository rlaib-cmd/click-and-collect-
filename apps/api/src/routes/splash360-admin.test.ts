import { describe, expect, it } from 'vitest';
import type { AppDeps } from '../app';
import { BELLA_ID, BELLA_RESTO, sessionToken, testSetup } from '../test-fixtures';

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
    });
    expect(res.status).toBe(409);
  });

  it('branche puis débranche un restaurant, et trace l’action', async () => {
    const setup = testSetup(probe(() => Promise.resolve({ products: 3, categories: 1 })));
    const on = await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: true },
    });
    expect(on.status).toBe(204);
    expect((await setup.deps.restaurants.findById(BELLA_ID, BELLA_RESTO))?.splash360Live).toBe(
      true,
    );
    await admin(setup, `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: false },
    });
    expect((await setup.deps.restaurants.findById(BELLA_ID, BELLA_RESTO))?.splash360Live).toBe(
      false,
    );
    const actions = setup.admin.audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['splash360.connect', 'splash360.disconnect']));
  });

  it('réserve le branchement au propriétaire et à Splash360', async () => {
    const res = await admin(testSetup(), `/restaurants/${BELLA_RESTO}/splash360`, {
      method: 'POST',
      body: { live: true },
      email: 'manager@bella.test',
    });
    expect(res.status).toBe(403);
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
    ).toEqual({ ok: false, message: 'Jeton Splash360 refusé (HTTP 400)' });

    expect(
      await (
        await admin(testSetup(), `/restaurants/${BELLA_RESTO}/splash360/test`, { method: 'POST' })
      ).json(),
    ).toEqual({ ok: false, message: 'Identifiants Splash360 absents du serveur' });
  });
});
