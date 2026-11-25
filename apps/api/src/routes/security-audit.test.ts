import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { BELLA_ID, JWT_SECRET, sessionToken, testSetup } from '../test-fixtures';

/** Corrections de l'audit de sécurité du 25/11 (une section par constat). */
const json = { 'Content-Type': 'application/json' };

async function as(email: string, claims: Record<string, unknown> = {}) {
  const token = await new SignJWT({ email, role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`auth-${email}`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return { Authorization: `Bearer ${token}`, 'X-Tenant-Id': BELLA_ID };
}

describe('H1 : comptes du back-office et enseignes', () => {
  it('refuse d’inviter dans une enseigne l’adresse du super-administrateur', async () => {
    const setup = testSetup();
    const res = await setup.app.request('/v1/admin/staff', {
      method: 'POST',
      headers: {
        ...json,
        Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
      },
      body: JSON.stringify({
        email: 'admin@splash360.test',
        name: null,
        role: 'manager',
        restaurantId: null,
      }),
    });
    expect(res.status).toBe(409);
    // Le super-administrateur garde son accès.
    const me = await setup.app.request('/v1/admin/me', {
      headers: await as('admin@splash360.test'),
    });
    expect(me.status).toBe(200);
  });
});

describe('M1 : rattachement seulement pour une adresse confirmée', () => {
  it('ne rattache pas une invitation en attente à un jeton dont l’adresse n’est pas confirmée', async () => {
    const setup = testSetup();
    await setup.app.request('/v1/admin/staff', {
      method: 'POST',
      headers: {
        ...json,
        Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
      },
      body: JSON.stringify({
        email: 'nouveau@bella.test',
        name: null,
        role: 'manager',
        restaurantId: null,
      }),
    });
    const unconfirmed = await setup.app.request('/v1/admin/me', {
      headers: await as('nouveau@bella.test', { user_metadata: { email_verified: false } }),
    });
    expect(unconfirmed.status).toBe(403);
    const anonymous = await setup.app.request('/v1/admin/me', {
      headers: await as('nouveau@bella.test', { is_anonymous: true }),
    });
    expect(anonymous.status).toBe(403);
    const confirmed = await setup.app.request('/v1/admin/me', {
      headers: await as('nouveau@bella.test', { user_metadata: { email_verified: true } }),
    });
    expect(confirmed.status).toBe(200);
  });
});

describe('Divers', () => {
  it('répond 400 à un X-Tenant-Id mal formé, sans erreur serveur', async () => {
    const setup = testSetup();
    const headers = { ...(await as('admin@splash360.test')), 'X-Tenant-Id': 'pas-un-uuid' };
    const res = await setup.app.request('/v1/admin/me', { headers });
    expect(res.status).toBe(400);
  });
});
