import { can, PERMISSIONS, type Permission, type StaffRole } from '@splash360/core';
import { describe, expect, it } from 'vitest';
import { BELLA_ID, BELLA_RESTO, sessionToken, STAFF_IDS, testSetup } from '../test-fixtures';

/**
 * Lot 13 (ADR 0017) : l'API applique la matrice de droits de @splash360/core, route par route.
 * Une requête par (rôle, permission) : 403 si le rôle n'a pas le droit, autre chose sinon.
 */
const ACCOUNTS: Record<Exclude<StaffRole, 'super_admin'>, string> = {
  tenant_admin: 'gerant@bella.test',
  manager: 'manager@bella.test',
  staff: 'equipe@bella.test',
};

const PROBES: Record<
  Exclude<Permission, 'platform'>,
  { method: string; path: string; body?: unknown }
> = {
  orders: { method: 'GET', path: '/orders' },
  'orders.refund': {
    method: 'POST',
    path: '/orders/00000000-0000-4000-8000-0000000000ff/refund',
    body: {},
  },
  'menu.pause': { method: 'GET', path: `/restaurants/${BELLA_RESTO}/menu` },
  'menu.manage': { method: 'POST', path: `/restaurants/${BELLA_RESTO}/menu/refresh` },
  'restaurants.settings': { method: 'GET', path: `/restaurants/${BELLA_RESTO}/settings` },
  design: { method: 'GET', path: '/theme/draft' },
  promos: { method: 'GET', path: '/promos' },
  loyalty: { method: 'GET', path: '/loyalty/members' },
  'loyalty.validate': {
    method: 'POST',
    path: '/ambassador/entries/00000000-0000-4000-8000-0000000000ff/validate',
  },
  proximity: { method: 'GET', path: '/proximity' },
  dashboard: { method: 'GET', path: '/dashboard' },
  customers: { method: 'GET', path: '/customers' },
  audit: { method: 'GET', path: '/audit' },
  payments: { method: 'POST', path: `/restaurants/${BELLA_RESTO}/stripe/onboarding`, body: {} },
  team: { method: 'GET', path: '/staff' },
};

async function call(email: string, probe: { method: string; path: string; body?: unknown }) {
  const { app } = testSetup();
  return app.request(`/v1/admin${probe.path}`, {
    method: probe.method,
    headers: {
      Authorization: `Bearer ${await sessionToken(email)}`,
      'X-Tenant-Id': BELLA_ID,
      'Content-Type': 'application/json',
    },
    ...(probe.body !== undefined ? { body: JSON.stringify(probe.body) } : {}),
  });
}

describe('droits par rôle sur l’API du back-office', () => {
  for (const [role, email] of Object.entries(ACCOUNTS) as [keyof typeof ACCOUNTS, string][]) {
    for (const permission of PERMISSIONS) {
      if (permission === 'platform') continue;
      const allowed = can(role, permission);
      it(`${role} · ${permission} → ${allowed ? 'autorisé' : '403'}`, async () => {
        const res = await call(email, PROBES[permission]);
        if (allowed) expect(res.status).not.toBe(403);
        else expect(res.status).toBe(403);
      });
    }
  }

  it('seul le super-administrateur voit la console des enseignes', async () => {
    for (const email of Object.values(ACCOUNTS))
      expect((await call(email, { method: 'GET', path: '/tenants' })).status).toBe(403);
    const { app } = testSetup();
    const res = await app.request('/v1/admin/tenants', {
      headers: { Authorization: `Bearer ${await sessionToken('admin@splash360.test')}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('équipe : rôles attribués par le propriétaire', () => {
  const headers = async (email: string) => ({
    Authorization: `Bearer ${await sessionToken(email)}`,
    'X-Tenant-Id': BELLA_ID,
    'Content-Type': 'application/json',
  });

  it('le propriétaire invite un gérant ; un gérant ne peut inviter personne', async () => {
    const { app } = testSetup();
    const invite = { email: 'nouveau@bella.test', name: null, role: 'manager', restaurantId: null };
    const ok = await app.request('/v1/admin/staff', {
      method: 'POST',
      headers: await headers('gerant@bella.test'),
      body: JSON.stringify(invite),
    });
    expect(ok.status).toBe(201);
    const denied = await app.request('/v1/admin/staff', {
      method: 'POST',
      headers: await headers('manager@bella.test'),
      body: JSON.stringify({ ...invite, email: 'autre@bella.test' }),
    });
    expect(denied.status).toBe(403);
  });

  it('le propriétaire change un rôle ; un équipier exige un restaurant', async () => {
    const { app } = testSetup();
    const patch = async (body: unknown) =>
      app.request(`/v1/admin/staff/${STAFF_IDS.bellaManager}`, {
        method: 'PATCH',
        headers: await headers('gerant@bella.test'),
        body: JSON.stringify(body),
      });
    expect((await patch({ role: 'staff' })).status).toBe(400);
    expect((await patch({ role: 'staff', restaurantId: BELLA_RESTO })).status).toBe(204);
    const list = await app.request('/v1/admin/staff', {
      headers: await headers('gerant@bella.test'),
    });
    const body = (await list.json()) as {
      staff: { id: string; role: string; restaurantId: string | null }[];
    };
    const member = body.staff.find((m) => m.id === STAFF_IDS.bellaManager);
    expect(member).toMatchObject({ role: 'staff', restaurantId: BELLA_RESTO });
  });

  it('personne ne modifie son propre compte', async () => {
    const { app } = testSetup();
    const res = await app.request(`/v1/admin/staff/${STAFF_IDS.bellaAdmin}`, {
      method: 'PATCH',
      headers: await headers('gerant@bella.test'),
      body: JSON.stringify({ role: 'manager' }),
    });
    expect(res.status).toBe(409);
  });

  it('la liste de l’équipe indique les invitations en attente', async () => {
    const { app } = testSetup();
    const res = await app.request('/v1/admin/staff', {
      headers: await headers('gerant@bella.test'),
    });
    const body = (await res.json()) as {
      staff: { email: string; pending: boolean; disabled: boolean }[];
    };
    expect(body.staff.every((m) => typeof m.pending === 'boolean' && m.disabled === false)).toBe(
      true,
    );
  });
});
