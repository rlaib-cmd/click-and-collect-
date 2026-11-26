import { Buffer } from 'node:buffer';
import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import { parseWebhookSecrets, signWebhook } from '@splash360/api-menu';
import {
  apiErrorSchema,
  loyaltySessionSchema,
  menuSchema,
  placedOrderSchema,
  quoteSchema,
  splash360WebhookLogSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { createMemorySplash360WebhookStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import {
  BELLA_ID,
  BELLA_RESTO,
  GREEN_ID,
  GREEN_RESTO,
  NOW,
  sessionToken,
  testSetup,
} from '../test-fixtures';

const SECRET = `whsec_${Buffer.alloc(32, 9).toString('base64')}`;
const OLD_SECRET = `whsec_${Buffer.alloc(32, 3).toString('base64')}`;
const [KEY] = parseWebhookSecrets(SECRET);
const STATION = '123_4abc5def';
const json = { 'Content-Type': 'application/json' };

const programs = new Map<string, LoyaltyProgram>([
  [
    'S360-DEMO-BELLA',
    {
      name: 'Club Bella',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [{ id: 'rw-tiramisu', name: 'Tiramisu', costPoints: 100, productIds: [] }],
    },
  ],
]);

async function setup(options: { secrets?: string; now?: () => Date } = {}) {
  const store = createMemorySplash360WebhookStore();
  const tasks: Promise<unknown>[] = [];
  const logs: { message: string; detail?: Record<string, unknown> }[] = [];
  let n = 0;
  const s = testSetup({
    splash360Webhooks: store,
    splash360WebhookKeys: parseWebhookSecrets(options.secrets ?? `${SECRET},${OLD_SECRET}`),
    background: (_name, task) => tasks.push(task),
    loyalty: createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => `carte-${++n}-0000-0000-0000`,
      programs,
    ),
    loyaltyDemoLogin: true,
    logger: (_level, message, detail) => logs.push({ message, ...(detail ? { detail } : {}) }),
    ...(options.now ? { now: options.now } : {}),
  });
  // Paiement sur place proposé par Bella (ADR 0010).
  const base = s.backend.ordering.getConfig.bind(s.backend.ordering);
  s.backend.ordering.getConfig = async (tenantId, restaurantId) => {
    const config = await base(tenantId, restaurantId);
    return config ? { ...config, payOnSiteEnabled: true } : null;
  };
  expect(await s.deps.restaurants.setSplash360Station(BELLA_ID, BELLA_RESTO, STATION)).toBe('ok');
  /** Attend la fin des traitements en tâche de fond. */
  const settle = async () => {
    while (tasks.length > 0) await Promise.all(tasks.splice(0));
  };
  return { ...s, store, tasks, logs, settle };
}
type Setup = Awaited<ReturnType<typeof setup>>;

let counter = 0;
function send(
  s: Setup,
  event: string,
  body: unknown,
  over: {
    id?: string;
    station?: string;
    at?: Date;
    signature?: string;
    raw?: string;
    key?: Uint8Array;
  } = {},
) {
  const raw = over.raw ?? JSON.stringify(body);
  const id = over.id ?? `msg_${++counter}`;
  const ts = Math.floor((over.at ?? NOW).getTime() / 1000);
  const key = over.key ?? KEY;
  if (!key) throw new Error('clé absente');
  return s.app.request(
    `/v1/webhooks/splash360/${event}/${encodeURIComponent(over.station ?? STATION)}`,
    {
      method: 'POST',
      headers: {
        ...json,
        'User-Agent': 'Splash360-Webhooks/1.0',
        'webhook-id': id,
        'webhook-timestamp': String(ts),
        'webhook-signature': over.signature ?? signWebhook(key, id, ts, raw),
      },
      body: raw,
    },
  );
}

const menu = async (s: Setup, mode = 'pickup') =>
  menuSchema.parse(
    await (
      await s.app.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu?mode=${mode}`)
    ).json(),
  );
const product = (m: Awaited<ReturnType<typeof menu>>, id: string) =>
  m.categories.flatMap((c) => c.products).find((p) => p.id === id);

const near = {
  label: '8 Boulevard Richard-Lenoir 75011 Paris',
  postalCode: '75011',
  city: 'Paris',
  latitude: 48.8565,
  longitude: 2.3707,
};
const quote = (s: Setup, body: Record<string, unknown>) =>
  s.app.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/quote`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      mode: 'pickup',
      address: null,
      requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
      ...body,
    }),
  });

describe('webhooks Splash360 : réception', () => {
  it('vecteur de test : signature vérifiée sur les octets reçus, horloge injectée', async () => {
    const at = new Date(1614265330 * 1000);
    const s = await setup({ secrets: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', now: () => at });
    const signed = {
      id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      at,
      raw: '{"test": 2432232314}',
      signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    };
    expect((await send(s, 'catalog', null, signed)).status).toBe(200);
    // Même contenu JSON, octets différents : refusé.
    const reserialized = await send(s, 'catalog', null, { ...signed, raw: '{"test":2432232314}' });
    expect(reserialized.status).toBe(401);
  });

  it('refuse sans motif : signature fausse, horodatage à plus de 5 minutes, en-têtes absents', async () => {
    const s = await setup();
    const bad = await send(s, 'stock', [], { signature: 'v1,AAAA' });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toBe('');
    const stale = await send(s, 'stock', [], { at: new Date(NOW.getTime() - 301_000) });
    expect(stale.status).toBe(401);
    const future = await send(s, 'stock', [], { at: new Date(NOW.getTime() + 301_000) });
    expect(future.status).toBe(401);
    const none = await s.app.request(`/v1/webhooks/splash360/stock/${STATION}`, {
      method: 'POST',
      body: '[]',
    });
    expect(none.status).toBe(401);
    // Rien d'enregistré pour un appel refusé.
    expect(s.store.receipts).toHaveLength(0);
  });

  it('accepte l’ancien et le nouveau secret pendant la bascule (deux signatures)', async () => {
    const s = await setup();
    const [oldKey] = parseWebhookSecrets(OLD_SECRET);
    if (!oldKey) throw new Error('clé absente');
    expect((await send(s, 'stock', [], { key: oldKey })).status).toBe(200);
    const other = parseWebhookSecrets(`whsec_${Buffer.alloc(32, 1).toString('base64')}`)[0];
    if (!other || !KEY) throw new Error('clé absente');
    const raw = '[]';
    const ts = Math.floor(NOW.getTime() / 1000);
    const both = `${signWebhook(other, 'msg_bascule', ts, raw)} ${signWebhook(KEY, 'msg_bascule', ts, raw)}`;
    expect((await send(s, 'stock', null, { id: 'msg_bascule', raw, signature: both })).status).toBe(
      200,
    );
  });

  it('sans secret posé : 503 ; événement inconnu : 404', async () => {
    const s = await setup({ secrets: '' });
    expect((await send(s, 'stock', [])).status).toBe(503);
    const s2 = await setup();
    expect((await send(s2, 'menus', [])).status).toBe(404);
  });

  it('challenge : renvoie la même valeur, signature exigée aussi', async () => {
    const s = await setup();
    const res = await send(s, 'orders', { challenge: 'dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U' });
    const unsigned = await send(s, 'orders', { challenge: 'x' }, { signature: 'v1,AAAA' });
    expect(unsigned.status).toBe(401);
    expect(s.store.receipts).toHaveLength(0);
  });

  it('dédoublonne sur webhook-id : une nouvelle tentative ne réapplique pas un ancien état', async () => {
    const s = await setup();
    const id = 'msg_hors_stock';
    expect(
      (await send(s, 'stock', [{ item_id: 'p-tiramisu', status: 'unavailable' }], { id })).status,
    ).toBe(200);
    await send(s, 'stock', [{ item_id: 'p-tiramisu', status: 'available' }]);
    await s.settle();
    // La tentative en retard du premier appel (même webhook-id) arrive après l'état plus récent.
    const retry = await send(s, 'stock', [{ item_id: 'p-tiramisu', status: 'unavailable' }], {
      id,
    });
    expect(retry.status).toBe(200);
    await s.settle();
    expect(product(await menu(s), 'p-tiramisu')?.available).toBe(true);
    expect(s.store.receipts.filter((r) => r.webhookId === id)).toHaveLength(1);
  });

  it('station inconnue : 2xx, journal avec 4 caractères seulement, appel visible au back-office', async () => {
    const s = await setup();
    const res = await send(s, 'stock', [{ item_id: 'prd1', status: 'unavailable' }], {
      station: '999_zzzzsecretpart',
    });
    expect(res.status).toBe(200);
    await s.settle();
    expect(s.store.receipts[0]).toMatchObject({
      outcome: 'unknown_station',
      stationId: '999_zzzzsecretpart',
      tenantId: null,
    });
    const warning = s.logs.find((l) => l.message.includes('station inconnue'));
    expect(warning?.detail).toEqual({ event: 'stock', station: '999_…' });
    expect(JSON.stringify(s.logs)).not.toContain('zzzz');
    expect(await s.store.listOverrides(BELLA_RESTO)).toEqual([]);
  });

  it('corps illisible pour l’événement : 2xx, noté en échec', async () => {
    const s = await setup();
    expect((await send(s, 'stock', { item_id: 'prd1' })).status).toBe(200);
    expect(s.store.receipts[0]).toMatchObject({
      outcome: 'failed',
      summary: { error: 'invalid_body' },
    });
    expect((await send(s, 'stock', null, { raw: '{pas du json' })).status).toBe(400);
  });
});

describe('webhooks Splash360 : disponibilité, prix de livraison, catalogue', () => {
  it('article hors stock : carte et devis ; option hors stock : non choisissable', async () => {
    const s = await setup();
    await send(s, 'stock', [
      { item_id: 'p-tiramisu', status: 'unavailable' },
      { item_id: 'opt-grande', status: 'unavailable' },
    ]);
    await s.settle();
    expect(s.store.receipts[0]).toMatchObject({
      outcome: 'applied',
      summary: { items: 2, unavailable: 2, skipped: 0 },
    });
    const m = await menu(s);
    expect(product(m, 'p-tiramisu')?.available).toBe(false);
    const grande = product(m, 'p-margherita')
      ?.optionGroups.flatMap((g) => g.options)
      .find((o) => o.id === 'opt-grande');
    expect(grande?.available).toBe(false);
    const res = await quote(s, {
      lines: [
        { productId: 'p-tiramisu', quantity: 1, optionIds: [] },
        { productId: 'p-margherita', quantity: 1, optionIds: ['opt-grande'] },
      ],
    });
    expect(res.status).toBe(422);
    const codes = apiErrorSchema.parse(await res.json()).error.issues?.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['product_unavailable', 'option_unavailable']));
    // Retour en stock : de nouveau commandable.
    await send(s, 'stock', [{ item_id: 'p-tiramisu', status: 'available' }]);
    await s.settle();
    expect(product(await menu(s), 'p-tiramisu')?.available).toBe(true);
  });

  it('appel de test (tableau vide) : rien ne change', async () => {
    const s = await setup();
    await send(s, 'stock', []);
    await send(s, 'prices', []);
    await s.settle();
    expect(s.store.receipts.map((r) => r.outcome)).toEqual(['test', 'test']);
    expect(await s.store.listOverrides(BELLA_RESTO)).toEqual([]);
  });

  it('prix de livraison propre : carte en livraison et calcul serveur, à emporter inchangé', async () => {
    const s = await setup();
    await send(s, 'prices', [{ item_id: 'opt-grande', price: 5 }]);
    await send(s, 'prices', [{ item_id: 'p-margherita', price: 11 }]);
    await s.settle();
    expect(product(await menu(s, 'delivery'), 'p-margherita')?.priceCents).toBe(1100);
    expect(product(await menu(s, 'pickup'), 'p-margherita')?.priceCents).toBe(1050);
    const lines = [{ productId: 'p-margherita', quantity: 3, optionIds: ['opt-grande'] }];
    const delivery = quoteSchema.parse(
      await (await quote(s, { mode: 'delivery', address: near, lines })).json(),
    );
    expect(delivery.totals.subtotalCents).toBe(3 * (1100 + 500));
    const pickup = quoteSchema.parse(await (await quote(s, { lines })).json());
    expect(pickup.totals.subtotalCents).toBe(3 * (1050 + 400));
  });

  it('mise à jour du catalogue : carte rechargée, prix propres effacés, disponibilités gardées', async () => {
    let now = NOW;
    const s = await setup({ now: () => now });
    await send(s, 'prices', [{ item_id: 'p-margherita', price: 11 }]);
    await send(s, 'stock', [{ item_id: 'p-tiramisu', status: 'unavailable' }]);
    await s.settle();
    now = new Date(NOW.getTime() + 60_000);
    // Appel de test : aucun effet.
    await send(s, 'catalog', { catalog_id: 0, revision: 0, installed_at: '…' }, { at: now });
    await s.settle();
    expect(product(await menu(s, 'delivery'), 'p-margherita')?.priceCents).toBe(1100);
    await send(
      s,
      'catalog',
      { catalog_id: 12, revision: 34, installed_at: new Date(now.getTime() - 1000).toISOString() },
      { at: now },
    );
    await s.settle();
    expect(s.store.receipts.at(-1)).toMatchObject({
      outcome: 'applied',
      summary: { catalogId: '12', revision: '34', clearedPrices: 1 },
    });
    expect(product(await menu(s, 'delivery'), 'p-margherita')?.priceCents).not.toBe(1100);
    expect(product(await menu(s), 'p-tiramisu')?.available).toBe(false);
  });
});

const onSiteOrder = (memberToken: string, key: string): PlaceOrderRequest => ({
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
  lines: [{ productId: 'p-tiramisu', quantity: 2, optionIds: [] }],
  customer: {
    name: 'Camille',
    email: 'camille@example.fr',
    phone: '0612345678',
    marketingConsent: false,
  },
  idempotencyKey: key,
  acceptedTerms: true,
  loyalty: { memberToken, rewardId: null },
  paymentMethod: 'on_site',
});

async function placeOnSite(s: Setup, key = 'cle-sur-place-webhook-1') {
  const session = loyaltySessionSchema.parse(
    await (
      await s.app.request('/v1/tenants/bella/loyalty/join', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          name: 'Camille',
          email: `${key}@example.fr`,
          phone: null,
          acceptedTerms: true,
        }),
      })
    ).json(),
  );
  const res = await s.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(onSiteOrder(session.memberToken, key)),
  });
  expect(res.status).toBe(201);
  const placed = placedOrderSchema.parse(await res.json());
  const stored = s.backend.orders.find((o) => o.id === placed.orderId);
  if (!stored?.pos) throw new Error('commande sans ticket de caisse');
  return { placed, stored, ticketId: stored.pos.ticketId };
}

async function placeOnline(s: Setup) {
  const { loyalty: _l, paymentMethod: _p, ...request } = onSiteOrder('', 'cle-en-ligne-webhook-01');
  const res = await s.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(request),
  });
  const placed = placedOrderSchema.parse(await res.json());
  await s.app.request(`/v1/tenants/bella/orders/${placed.orderId}/payment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${placed.accessToken}` },
  });
  await s.app.request('/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'whsec_test' },
    body: JSON.stringify({
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1300,
      currency: 'eur',
    }),
  });
  const stored = s.backend.orders.find((o) => o.id === placed.orderId);
  if (!stored?.pos) throw new Error('commande sans ticket de caisse');
  return { placed, stored, ticketId: stored.pos.ticketId };
}

const orderEvent = (
  ticketId: string,
  status: 'paid' | 'cancelled',
  reason: string | null = null,
) => ({
  order_id: ticketId,
  status,
  amount: 13,
  occurred_at: '2026-11-24T10:43:58.658843+01:00',
  reason,
  champ_futur: 'ignoré',
});

describe('webhooks Splash360 : encaissement et annulation en caisse', () => {
  it('sur place encaissée : commande remise, points du club acquis, client prévenu ; idempotent', async () => {
    const s = await setup();
    const { stored, ticketId } = await placeOnSite(s);
    expect(stored.status).toBe('confirmed');
    expect(stored.loyaltySettled).toBeFalsy();
    await send(s, 'orders', orderEvent(ticketId, 'paid'));
    await s.settle();
    expect(stored.status).toBe('completed');
    expect(stored.loyaltySettled).toBe(true);
    expect(stored.events.filter((e) => e.actor === 'caisse').map((e) => e.status)).toEqual([
      'pos_paid',
      'completed',
    ]);
    expect(s.notifications.pushes.length + s.notifications.emails.length).toBeGreaterThan(0);
    // Rejeu manuel (nouveau webhook-id) : idempotent sur commande + statut.
    await send(s, 'orders', orderEvent(ticketId.toUpperCase(), 'paid'));
    await s.settle();
    expect(stored.events.filter((e) => e.actor === 'caisse')).toHaveLength(2);
    expect(s.store.receipts.at(-1)).toMatchObject({ outcome: 'ignored' });
  });

  it('sur place annulée : annulée comme par la caisse, motif gardé dans l’historique', async () => {
    const s = await setup();
    const { stored, ticketId } = await placeOnSite(s);
    await send(s, 'orders', orderEvent(ticketId, 'cancelled', 'Client absent'));
    await s.settle();
    expect(stored.status).toBe('cancelled');
    expect(stored.events.find((e) => e.status === 'pos_cancelled')).toMatchObject({
      actor: 'caisse',
      note: 'Client absent',
    });
    // Annulée puis « encaissée » arrivée en retard : rien ne change.
    await send(s, 'orders', orderEvent(ticketId, 'paid'));
    await s.settle();
    expect(stored.status).toBe('cancelled');
    expect(stored.loyaltySettled).toBeFalsy();
  });

  it('payée en ligne puis annulée en caisse : remboursée intégralement, une seule fois', async () => {
    const s = await setup();
    const { stored, ticketId } = await placeOnline(s);
    expect(stored.status).toBe('paid');
    await send(s, 'orders', orderEvent(ticketId, 'cancelled', 'Rupture'));
    await s.settle();
    expect(stored.status).toBe('refunded');
    expect(stored.refundedCents).toBe(1300);
    expect(s.stripe.refunds).toHaveLength(1);
    expect(stored.events.find((e) => e.status === 'refunded')?.actor).toBe('caisse');
    await send(s, 'orders', orderEvent(ticketId, 'cancelled', 'Rupture'));
    await s.settle();
    expect(s.stripe.refunds).toHaveLength(1);
  });

  it('en ligne « encaissée » en caisse : simple trace, jamais « payée » sans Stripe', async () => {
    const s = await setup();
    const { stored, ticketId } = await placeOnline(s);
    const before = stored.status;
    await send(s, 'orders', orderEvent(ticketId, 'paid'));
    await s.settle();
    expect(stored.status).toBe(before);
    expect(stored.events.at(-1)).toMatchObject({ status: 'pos_paid', actor: 'caisse' });
  });

  it('commande de test (TEST-) et commande inconnue : 2xx, rien ne change', async () => {
    const s = await setup();
    const { stored } = await placeOnSite(s);
    const test = await send(s, 'orders', {
      order_id: 'TEST-6a1f0c2e-8b3d-4f5a-9c7e-1d2b3a4c5d6e',
      status: 'paid',
      amount: 0,
      occurred_at: '…',
      reason: 'Test call from the Splash360 back office',
    });
    expect(test.status).toBe(200);
    await send(s, 'orders', orderEvent('6a1f0c2e-0000-4000-8000-000000000000', 'cancelled'));
    await s.settle();
    expect(s.store.receipts.map((r) => r.outcome)).toEqual(['test', 'unknown_order']);
    expect(stored.status).toBe('confirmed');
  });

  it('commande d’un autre restaurant : jamais touchée par la station de Bella', async () => {
    const s = await setup();
    const { stored, ticketId } = await placeOnSite(s);
    await s.deps.restaurants.setSplash360Station(BELLA_ID, BELLA_RESTO, null);
    await s.deps.restaurants.setSplash360Station(GREEN_ID, GREEN_RESTO, STATION);
    await send(s, 'orders', orderEvent(ticketId, 'cancelled'));
    await s.settle();
    expect(stored.status).toBe('confirmed');
    expect(s.store.receipts.at(-1)).toMatchObject({ outcome: 'unknown_order' });
  });
});

describe('webhooks Splash360 : back-office', () => {
  const admin = async (
    s: Setup,
    email: string,
    path: string,
    init: RequestInit = {},
    tenant: string | null = BELLA_ID,
  ) =>
    s.app.request(`/v1/admin${path}`, {
      ...init,
      headers: {
        ...json,
        Authorization: `Bearer ${await sessionToken(email)}`,
        ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
      },
    });

  it('station réglée par le super-administrateur seulement, unique', async () => {
    const s = await setup();
    const put = (email: string, stationId: string | null) =>
      admin(s, email, `/restaurants/${BELLA_RESTO}/splash360/station`, {
        method: 'PUT',
        body: JSON.stringify({ stationId }),
      });
    expect((await put('gerant@bella.test', 'abc_1')).status).toBe(403);
    expect((await put('admin@splash360.test', 'pas valide !')).status).toBe(400);
    expect((await put('admin@splash360.test', '456_9xyz')).status).toBe(204);
    await s.deps.restaurants.setSplash360Station(GREEN_ID, GREEN_RESTO, 'green_1');
    expect((await put('admin@splash360.test', 'green_1')).status).toBe(409);
    const list = (await (await admin(s, 'gerant@bella.test', '/restaurants')).json()) as {
      restaurants: { id: string; splash360StationId: string | null }[];
    };
    expect(list.restaurants.find((r) => r.id === BELLA_RESTO)?.splash360StationId).toBe('456_9xyz');
  });

  it('nombre d’états de la caisse et journal des webhooks reçus (super-administrateur)', async () => {
    const s = await setup();
    await send(s, 'stock', [
      { item_id: 'p-tiramisu', status: 'unavailable' },
      { item_id: 'opt-grande', status: 'available' },
    ]);
    await send(s, 'prices', [{ item_id: 'opt-grande', price: 5 }]);
    await send(s, 'orders', orderEvent('inconnu', 'paid'), { station: 'nouvelle_station' });
    await s.settle();
    const list = (await (await admin(s, 'gerant@bella.test', '/restaurants')).json()) as {
      restaurants: { id: string; stock: unknown }[];
    };
    expect(list.restaurants.find((r) => r.id === BELLA_RESTO)?.stock).toEqual({
      unavailable: 1,
      deliveryPrices: 1,
    });
    expect((await admin(s, 'gerant@bella.test', '/splash360/webhooks')).status).toBe(403);
    const res = await admin(s, 'admin@splash360.test', '/splash360/webhooks', {}, null);
    expect(res.status).toBe(200);
    const log = splash360WebhookLogSchema.parse(await res.json());
    expect(log.configured).toBe(true);
    expect(log.receipts).toHaveLength(3);
    expect(log.receipts.map((r) => r.outcome).sort()).toEqual([
      'applied',
      'applied',
      'unknown_station',
    ]);
    // Aucune donnée personnelle ni corps brut dans le journal.
    expect(JSON.stringify(log)).not.toContain('camille');
  });

  it('purge des appels reçus après 7 jours (dédoublonnage gardé au moins 48 h)', async () => {
    let now = NOW;
    const s = await setup({ now: () => now });
    await send(s, 'stock', []);
    now = new Date(NOW.getTime() + 3 * 24 * 3_600_000);
    expect(await s.app.runSplash360Purge()).toBe(0);
    now = new Date(NOW.getTime() + 8 * 24 * 3_600_000);
    expect(await s.app.runSplash360Purge()).toBe(1);
  });
});
