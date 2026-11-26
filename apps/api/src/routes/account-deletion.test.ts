import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import { DEFAULT_PROXIMITY_RULES } from '@splash360/core';
import { loyaltyProgramSchema, loyaltySessionSchema } from '@splash360/contracts';
import {
  createMemoryAmbassadorStore,
  createMemoryProximityStore,
  createMemoryStripeCustomerStore,
  ERASED_MEMBER,
} from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createFakeCardGateway } from '../payments/cards';
import { BELLA_ID, sessionToken, testSetup } from '../test-fixtures';

/** « Supprimer mon compte » dans l'application (ADR 0028, App Store 5.1.1(v)). */
const programs = new Map<string, LoyaltyProgram>([
  ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] }],
]);

/** Mardi 24/11/2026, 12:00 à Paris : Bella est ouvert (zone « à proximité » utilisable). */
const NOON = new Date('2026-11-24T11:00:00.000Z');
const base = '/v1/tenants/bella';
const json = { 'Content-Type': 'application/json' };

function setup(options: { rateLimit?: number } = {}) {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const proximity = createMemoryProximityStore(() => []);
  const ambassador = createMemoryAmbassadorStore({
    [BELLA_ID]: { enabled: true, instagramHandle: 'pizzeriabella', bonusPoints: 50 },
  });
  const cards = createFakeCardGateway();
  const customers = createMemoryStripeCustomerStore();
  const s = testSetup({
    loyalty,
    loyaltyDemoLogin: true,
    proximity: proximity.store,
    ambassador,
    cardGateway: cards.gateway,
    stripeCustomers: customers,
    now: () => NOON,
    ...(options.rateLimit ? { rateLimits: { orders: options.rateLimit, reads: 1000 } } : {}),
  });
  return { ...s, proximity, ambassador, cards, customers };
}
type Setup = ReturnType<typeof setup>;

const call = (s: Setup, method: string, path: string, token: string | null, body?: unknown) =>
  s.app.request(`${base}${path}`, {
    method,
    headers: { ...json, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function join(s: Setup, email = 'camille@example.fr') {
  const res = await call(s, 'POST', '/loyalty/join', null, {
    name: 'Camille',
    email,
    phone: null,
    acceptedTerms: true,
  });
  const session = loyaltySessionSchema.parse(await res.json());
  return { token: session.memberToken, id: session.memberToken.split('.')[1] ?? '' };
}

const remove = (s: Setup, token: string | null) => call(s, 'DELETE', '/loyalty/me', token);

/** Données liées au membre : carte, appareil et événement « à proximité », Ambassadeur. */
async function withData(s: Setup, m: { token: string; id: string }) {
  const setupRes = await call(s, 'POST', '/loyalty/me/cards/setup', m.token);
  const secret = ((await setupRes.json()) as { clientSecret: string }).clientSecret;
  const customer = /^seti_(cus_[a-z0-9]+)_/.exec(secret)?.[1] ?? '';
  s.cards.addCard(customer, 'pm_carte1');

  const settings = await s.app.request('/v1/admin/proximity/settings', {
    method: 'PUT',
    headers: {
      ...json,
      Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
      'X-Tenant-Id': BELLA_ID,
    },
    body: JSON.stringify({ ...DEFAULT_PROXIMITY_RULES, enabled: true }),
  });
  expect(settings.status).toBe(204);
  const device = { token: 'ExponentPushToken[appareil-1]', platform: 'ios' };
  expect((await call(s, 'PUT', '/proximity/device', m.token, device)).status).toBe(204);
  await call(s, 'POST', '/proximity/enter', m.token, {
    restaurantId: '10000000-0000-4000-8000-000000000001',
  });

  await s.ambassador.saveProfile(BELLA_ID, m.id, 'camille.story');
  const entry = (ticketRef: string) =>
    s.ambassador.createEntry(
      {
        tenantId: BELLA_ID,
        memberId: m.id,
        ticketRef,
        instagramHandle: 'camille.story',
        bonusPoints: 50,
      },
      [{ type: 'created', actor: 'client', detail: { ticketRef, instagram: 'camille.story' } }],
    );
  const pending = await entry('BB-1001');
  const decided = await entry('BB-1002');
  if (!decided.ok || !pending.ok) throw new Error('participations non créées');
  await s.ambassador.decide(BELLA_ID, decided.entry.id, 'confirmed', NOON);
  return { customer, pending: pending.entry.id, decided: decided.entry.id };
}

describe('supprimer mon compte (ADR 0028)', () => {
  it('sans jeton de membre, ou avec un jeton falsifié : 401, rien n’est effacé', async () => {
    const s = setup();
    const m = await join(s);
    expect((await remove(s, null)).status).toBe(401);
    expect((await remove(s, `${m.token.slice(0, -4)}AAAA`)).status).toBe(401);
    const me = await call(s, 'GET', '/loyalty/me', m.token);
    expect(me.status).toBe(200);
    expect(s.admin.audit.some((a) => a.action === 'loyalty.member.delete')).toBe(false);
  });

  it('efface le compte et ses données, révoque la session, journalise « client »', async () => {
    const s = setup();
    const m = await join(s);
    const other = await join(s, 'lea@example.fr');
    const data = await withData(s, m);
    expect(s.proximity.devices).toHaveLength(1);
    expect(s.proximity.events.length).toBeGreaterThan(0);

    const res = await remove(s, m.token);
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    // Session révoquée : le jeton ne donne plus accès à rien.
    expect((await call(s, 'GET', '/loyalty/me', m.token)).status).toBe(401);
    expect((await call(s, 'GET', '/loyalty/me/orders', m.token)).status).toBe(401);
    expect((await call(s, 'GET', '/loyalty/me/cards', m.token)).status).toBe(401);
    // Carte détachée chez Stripe, lien supprimé.
    expect(await s.cards.gateway.cardCustomer('pm_carte1')).toBeNull();
    expect(await s.customers.find(BELLA_ID, m.id)).toBeNull();
    // « À proximité » : appareils et événements effacés.
    expect(s.proximity.devices).toHaveLength(0);
    expect(s.proximity.events.filter((e) => e.memberId === m.id)).toHaveLength(0);
    // Ambassadeur : profil et participation en attente effacés, participation décidée anonymisée.
    expect(await s.ambassador.getProfile(BELLA_ID, m.id)).toBeNull();
    expect(await s.ambassador.getEntry(BELLA_ID, data.pending)).toBeNull();
    expect(await s.ambassador.getEntry(BELLA_ID, data.decided)).toMatchObject({
      memberId: ERASED_MEMBER,
      instagramHandle: ERASED_MEMBER,
      status: 'confirmed',
    });
    const history = await s.ambassador.events(BELLA_ID, [data.decided]);
    expect(JSON.stringify(history)).not.toContain('camille.story');

    expect(s.admin.audit.filter((a) => a.action.startsWith('loyalty.'))).toEqual([
      expect.objectContaining({
        tenantId: BELLA_ID,
        actorEmail: 'client',
        action: 'loyalty.member.delete',
        target: m.id,
        detail: { cardsDetached: 1, ambassadorEntriesDeleted: 1, ambassadorEntriesAnonymised: 1 },
      }),
    ]);
    // Programme de démonstration : pas d'effacement chez un partenaire.
    const program = loyaltyProgramSchema.parse(
      await (await call(s, 'GET', '/loyalty/program', null)).json(),
    );
    expect(program).toMatchObject({ enabled: true, partnerErasure: false });
    // L'autre membre n'est pas touché.
    expect((await call(s, 'GET', '/loyalty/me', other.token)).status).toBe(200);
  });

  it('idempotent : un second appel avec le même jeton répond 204 sans rien journaliser', async () => {
    const s = setup();
    const m = await join(s);
    expect((await remove(s, m.token)).status).toBe(204);
    expect((await remove(s, m.token)).status).toBe(204);
    expect(s.admin.audit.filter((a) => a.action === 'loyalty.member.delete')).toHaveLength(1);
  });

  it('même plafond par adresse que la connexion au club', async () => {
    // 1 adhésion + 1 suppression, puis refus.
    const s = setup({ rateLimit: 2 });
    const m = await join(s);
    expect((await remove(s, m.token)).status).toBe(204);
    expect((await remove(s, m.token)).status).toBe(429);
  });

  it('back-office : même effacement (cartes, Ambassadeur, sessions), auteur = gérant', async () => {
    const s = setup();
    const m = await join(s);
    await withData(s, m);
    const res = await s.app.request(`/v1/admin/loyalty/members/${m.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
        'X-Tenant-Id': BELLA_ID,
      },
    });
    expect(res.status).toBe(204);
    expect((await call(s, 'GET', '/loyalty/me', m.token)).status).toBe(401);
    expect(await s.cards.gateway.cardCustomer('pm_carte1')).toBeNull();
    expect(await s.ambassador.getProfile(BELLA_ID, m.id)).toBeNull();
    expect(s.proximity.devices).toHaveLength(0);
    expect(s.admin.audit.at(-1)).toMatchObject({
      action: 'loyalty.member.delete',
      actorEmail: 'gerant@bella.test',
      target: m.id,
    });
  });
});
