import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import { DEFAULT_PROXIMITY_RULES } from '@splash360/core';
import {
  adminProximitySchema,
  loyaltySessionSchema,
  proximityPushDataSchema,
  proximityRegionsSchema,
  type ProximitySettingsDto,
} from '@splash360/contracts';
import { createMemoryProximityStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createFakeNotificationSender } from '../notifications/sender';
import { BELLA_ID, BELLA_RESTO, GREEN_RESTO, sessionToken, testSetup } from '../test-fixtures';

const programs = new Map<string, LoyaltyProgram>([
  [
    'S360-DEMO-BELLA',
    {
      name: 'Club Bella',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [
        { id: 'rw-tiramisu', name: 'Tiramisu', costPoints: 100, productIds: [] },
        { id: 'rw-pizza', name: 'Pizza', costPoints: 900, productIds: [] },
      ],
    },
  ],
]);

/** Mardi 24/11/2026, 12:00 à Paris : Bella est ouvert (11:30–14:30). */
const NOON = new Date('2026-11-24T11:00:00.000Z');
const DEVICE = 'ExponentPushToken[appareil-1]';
const base = '/v1/tenants/bella';
const json = { 'Content-Type': 'application/json' };

function setup(options: { failPush?: boolean; rateLimit?: number } = {}) {
  let clock = NOON;
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  const fake = createFakeNotificationSender();
  const notifier = options.failPush
    ? { ...fake.sender, push: () => Promise.reject(new Error('Expo push : HTTP 500')) }
    : fake.sender;
  let orders: () => {
    tenantId: string;
    memberId: string | null;
    status: string;
    createdAt: Date;
  }[] = () => [];
  const proximity = createMemoryProximityStore(() => orders());
  const s = testSetup({
    loyalty,
    loyaltyDemoLogin: true,
    proximity: proximity.store,
    notifier,
    now: () => clock,
    ...(options.rateLimit ? { rateLimits: { orders: options.rateLimit, reads: 1000 } } : {}),
  });
  orders = () =>
    s.backend.orders.map((o) => ({
      tenantId: o.tenantId,
      memberId: o.loyalty?.memberId ?? null,
      status: o.status,
      createdAt: new Date(o.createdAt),
    }));
  return {
    ...s,
    proximity,
    pushes: fake.pushes,
    setNow: (d: Date) => {
      clock = d;
    },
  };
}

type Setup = ReturnType<typeof setup>;

async function member(s: Setup, email = 'camille@example.fr') {
  const res = await s.app.request(`${base}/loyalty/join`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: 'Camille', email, phone: null, acceptedTerms: true }),
  });
  const session = loyaltySessionSchema.parse(await res.json());
  // Identifiant du membre : deuxième segment du jeton « m2.<id>.… ».
  return { token: session.memberToken, id: session.memberToken.split('.')[1] ?? '' };
}

const call = (s: Setup, method: string, path: string, token: string | null, body?: unknown) =>
  s.app.request(`${base}${path}`, {
    method,
    headers: { ...json, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function settings(
  s: Setup,
  over: Partial<ProximitySettingsDto> = {},
  email = 'gerant@bella.test',
) {
  return s.app.request('/v1/admin/proximity/settings', {
    method: 'PUT',
    headers: {
      ...json,
      Authorization: `Bearer ${await sessionToken(email)}`,
      'X-Tenant-Id': BELLA_ID,
    },
    body: JSON.stringify({ ...DEFAULT_PROXIMITY_RULES, enabled: true, ...over }),
  });
}

async function optIn(s: Setup, token: string, device = DEVICE) {
  const res = await call(s, 'PUT', '/proximity/device', token, { token: device, platform: 'ios' });
  expect(res.status).toBe(204);
}

const enter = (s: Setup, token: string | null, restaurantId = BELLA_RESTO) =>
  call(s, 'POST', '/proximity/enter', token, { restaurantId });

describe('bons plans à proximité : application', () => {
  it('sans session de membre : 401, rien n’est envoyé ni enregistré', async () => {
    const s = setup();
    await settings(s);
    expect((await enter(s, null)).status).toBe(401);
    expect((await enter(s, 'm2.faux.jeton.0.aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(401);
    expect((await call(s, 'GET', '/proximity', null)).status).toBe(401);
    expect(s.pushes).toHaveLength(0);
    expect(s.proximity.events).toHaveLength(0);
  });

  it('zones : restaurants actifs avec coordonnées, rayon de l’enseigne ; aucune si désactivée', async () => {
    const s = setup();
    const m = await member(s);
    const off = proximityRegionsSchema.parse(
      await (await call(s, 'GET', '/proximity', m.token)).json(),
    );
    expect(off).toEqual({ enabled: false, radiusMeters: 200, restaurants: [] });
    await settings(s, { radiusMeters: 300 });
    const on = proximityRegionsSchema.parse(
      await (await call(s, 'GET', '/proximity', m.token)).json(),
    );
    expect(on).toEqual({
      enabled: true,
      radiusMeters: 300,
      restaurants: [{ restaurantId: BELLA_RESTO, latitude: 48.8553, longitude: 2.3747 }],
    });
  });

  it('accord absent (pas d’appareil inscrit) : aucune notification, aucun événement', async () => {
    const s = setup();
    await settings(s);
    const m = await member(s);
    const res = await enter(s, m.token);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ notified: false });
    expect(s.pushes).toHaveLength(0);
    expect(s.proximity.events).toHaveLength(0);
  });

  it('fonction désactivée par l’enseigne : rien, même avec un appareil inscrit', async () => {
    const s = setup();
    const m = await member(s);
    await optIn(s, m.token);
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.pushes).toHaveLength(0);
    expect(s.proximity.events).toHaveLength(0);
  });

  it('entrée dans la zone : notification avec le nom du restaurant et le lien choisi', async () => {
    const s = setup();
    await settings(s, { title: '{restaurant} à deux pas', deepLink: 'avantages' });
    const m = await member(s);
    await optIn(s, m.token);
    const res = await enter(s, m.token);
    expect(await res.json()).toEqual({ notified: true });
    expect(s.pushes).toHaveLength(1);
    expect(s.pushes[0]).toMatchObject({ tokens: [DEVICE], title: 'Bella Bastille à deux pas' });
    const sent = s.proximity.events.find((e) => e.decision === 'sent');
    expect(sent).toMatchObject({ memberId: m.id, restaurantId: BELLA_RESTO });
    // Aucune position n'est enregistrée : membre, restaurant, instant, décision.
    expect(Object.keys(sent ?? {}).sort()).toEqual([
      'createdAt',
      'decision',
      'id',
      'memberId',
      'openedAt',
      'reason',
      'restaurantId',
      'tenantId',
    ]);
  });

  it('plafond par membre : une seule notification par 24 h, puis de nouveau le lendemain', async () => {
    const s = setup();
    await settings(s, { restaurantCapHours: 1 });
    const m = await member(s);
    await optIn(s, m.token);
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: true });
    s.setNow(new Date(NOON.getTime() + 2 * 3_600_000));
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.proximity.events.at(-1)).toMatchObject({ decision: 'skipped', reason: 'member_cap' });
    s.setNow(new Date(NOON.getTime() + 24 * 3_600_000));
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: true });
    expect(s.pushes).toHaveLength(2);
  });

  it('heures calmes et restaurant fermé : pas de notification', async () => {
    const s = setup();
    await settings(s, { quietHours: { start: '11:00', end: '13:00' } });
    const m = await member(s);
    await optIn(s, m.token);
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.proximity.events.at(-1)?.reason).toBe('quiet_hours');
    await settings(s, { quietHours: null });
    s.setNow(new Date('2026-11-24T15:00:00.000Z')); // 16:00 à Paris : entre deux services.
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.proximity.events.at(-1)?.reason).toBe('closed');
    expect(s.pushes).toHaveLength(0);
  });

  it('cible « cadeau disponible » : le solde vient du club', async () => {
    const s = setup();
    await settings(s, { target: 'reward' });
    const m = await member(s);
    await optIn(s, m.token);
    // 100 points de bienvenue ≥ tiramisu à 100 points.
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: true });
  });

  it('restaurant inconnu ou d’une autre enseigne : 404, rien d’enregistré', async () => {
    const s = setup();
    await settings(s);
    const m = await member(s);
    await optIn(s, m.token);
    expect((await enter(s, m.token, GREEN_RESTO)).status).toBe(404);
    expect((await enter(s, m.token, '10000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await call(s, 'POST', '/proximity/enter', m.token, { restaurantId: 'x' })).status).toBe(
      400,
    );
    expect(s.proximity.events).toHaveLength(0);
    expect(s.pushes).toHaveLength(0);
  });

  it('retrait de l’accord : appareils effacés côté serveur, plus de notification', async () => {
    const s = setup();
    await settings(s);
    const m = await member(s);
    await optIn(s, m.token);
    expect(s.proximity.devices).toHaveLength(1);
    expect((await call(s, 'POST', '/proximity/opt-out', m.token, { token: null })).status).toBe(
      204,
    );
    expect(s.proximity.devices).toHaveLength(0);
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(
      (await call(s, 'PUT', '/proximity/device', m.token, { token: 'abc', platform: 'ios' }))
        .status,
    ).toBe(400);
  });

  it('envoi Expo en échec : non notifié, le plafond n’est pas consommé', async () => {
    const s = setup({ failPush: true });
    await settings(s);
    const m = await member(s);
    await optIn(s, m.token);
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.proximity.events.at(-1)).toMatchObject({ decision: 'failed', reason: 'push_failed' });
    expect(await (await enter(s, m.token)).json()).toEqual({ notified: false });
    expect(s.proximity.events.filter((e) => e.decision === 'failed')).toHaveLength(2);
  });

  it('entrées limitées par adresse (même limiteur que les commandes)', async () => {
    // L'adhésion compte dans la même limite : 1 adhésion + 2 entrées.
    const s = setup({ rateLimit: 3 });
    const m = await member(s);
    expect((await enter(s, m.token)).status).toBe(202);
    expect((await enter(s, m.token)).status).toBe(202);
    expect((await enter(s, m.token)).status).toBe(429);
  });
});

describe('bons plans à proximité : back-office', () => {
  const admin = async (s: Setup, email = 'gerant@bella.test') =>
    s.app.request('/v1/admin/proximity', {
      headers: { Authorization: `Bearer ${await sessionToken(email)}`, 'X-Tenant-Id': BELLA_ID },
    });

  it('règles validées, réservées au gérant ; statistiques envois, ouvertures, commandes', async () => {
    const s = setup();
    expect((await settings(s, { radiusMeters: 50 })).status).toBe(400);
    expect((await settings(s, {}, 'manager@bella.test')).status).toBe(403);
    expect((await admin(s, 'manager@bella.test')).status).toBe(403);
    expect((await settings(s)).status).toBe(204);

    const m = await member(s);
    await optIn(s, m.token);
    await enter(s, m.token);
    // Données jointes à la notification : relues par l'application à l'ouverture.
    const data = proximityPushDataSchema.parse(s.pushes[0]?.data);
    expect(data).toEqual({
      kind: 'proximity',
      eventId: s.proximity.events.find((e) => e.decision === 'sent')?.id,
      link: 'commander',
    });
    // Ouverture signalée par l'application, une seule fois, par le bon membre seulement.
    const other = await member(s, 'autre@example.fr');
    expect(
      (await call(s, 'POST', '/proximity/opened', other.token, { eventId: data.eventId })).status,
    ).toBe(204);
    expect(
      (await call(s, 'POST', '/proximity/opened', m.token, { eventId: data.eventId })).status,
    ).toBe(204);

    const body = adminProximitySchema.parse(await (await admin(s)).json());
    expect(body.settings.enabled).toBe(true);
    expect(body.stats.last7Days).toEqual({ sent: 1, opened: 1, orders: 0 });
    expect(body.stats.optedInMembers).toBe(1);
    expect(s.admin.audit.some((a) => a.action === 'proximity.settings')).toBe(true);
  });
});
