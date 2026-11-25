import { describe, expect, it } from 'vitest';
import { BELLA_ID, sessionToken, testSetup } from '../test-fixtures';

/** Audit du 25/11 : un onglet du back-office qui recharge en boucle ne doit pas atteindre la base. */
describe('cache court des lectures du back-office', () => {
  async function get(setup: ReturnType<typeof testSetup>, email = 'gerant@bella.test') {
    return setup.app.request('/v1/admin/restaurants', {
      headers: { Authorization: `Bearer ${await sessionToken(email)}`, 'X-Tenant-Id': BELLA_ID },
    });
  }

  it('sert les lectures identiques rapprochées depuis la mémoire, et une écriture le vide', async () => {
    const setup = testSetup();
    let reads = 0;
    const original = setup.deps.restaurants.listByTenant.bind(setup.deps.restaurants);
    setup.deps.restaurants.listByTenant = (tenantId) => {
      reads += 1;
      return original(tenantId);
    };
    for (let i = 0; i < 20; i++) expect((await get(setup)).status).toBe(200);
    expect(reads).toBe(1);

    // Écriture : la lecture suivante repart de la base.
    await setup.app.request('/v1/admin/restaurants/inconnu/pause', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paused: true }),
    });
    expect((await get(setup)).status).toBe(200);
    expect(reads).toBe(2);
  });

  it('ne partage jamais une réponse entre deux comptes', async () => {
    const setup = testSetup();
    let reads = 0;
    const original = setup.deps.restaurants.listByTenant.bind(setup.deps.restaurants);
    setup.deps.restaurants.listByTenant = (tenantId) => {
      reads += 1;
      return original(tenantId);
    };
    await get(setup, 'gerant@bella.test');
    await get(setup, 'admin@splash360.test');
    expect(reads).toBe(2);
  });
});
