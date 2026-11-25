import { createDemoLoyaltyProvider, createMemoryDemoLoyaltyStore } from '@splash360/api-loyalty';
import {
  cardSetupSchema,
  loyaltySessionSchema,
  placedOrderSchema,
  savedCardPaymentSchema,
  savedCardsSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { createMemoryStripeCustomerStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createFakeCardGateway } from '../payments/cards';
import { BELLA_RESTO, testSetup } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };
const base = '/v1/tenants/bella';

function setup(overrides: Parameters<typeof testSetup>[0] = {}) {
  let n = 0;
  const cards = createFakeCardGateway();
  const customers = createMemoryStripeCustomerStore();
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    new Map([
      ['S360-DEMO-BELLA', { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 0, rewards: [] }],
    ]),
  );
  const s = testSetup({
    loyalty,
    cardGateway: cards.gateway,
    stripeCustomers: customers,
    ...overrides,
  });
  return { ...s, cards, customers };
}
type Setup = ReturnType<typeof setup>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function join(s: Setup, email = 'camille@example.fr') {
  const res = await s.app.request(`${base}/loyalty/join`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: 'Camille', email, phone: null, acceptedTerms: true }),
  });
  return loyaltySessionSchema.parse(await res.json()).memberToken;
}

/** Ajout d'une carte : SetupIntent côté serveur, puis carte « confirmée » par le faux Stripe. */
async function addCard(s: Setup, token: string, id: string, last4 = '4242') {
  const res = await s.app.request(`${base}/loyalty/me/cards/setup`, {
    method: 'POST',
    headers: bearer(token),
  });
  expect(res.status).toBe(201);
  const setupIntent = cardSetupSchema.parse(await res.json());
  const customer = /^seti_(cus_[a-z0-9]+)_/.exec(setupIntent.clientSecret)?.[1];
  if (!customer) throw new Error('client Stripe introuvable');
  s.cards.addCard(customer, id, last4);
  return customer;
}

const listCards = async (s: Setup, token: string) =>
  savedCardsSchema.parse(
    await (await s.app.request(`${base}/loyalty/me/cards`, { headers: bearer(token) })).json(),
  ).cards;

const order: PlaceOrderRequest = {
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
  lines: [{ productId: 'p-margherita', quantity: 1, optionIds: ['opt-grande'] }],
  customer: {
    name: 'Camille Martin',
    email: 'camille@example.fr',
    phone: '0612345678',
    marketingConsent: false,
  },
  idempotencyKey: 'cle-carte-enregistree-01',
  acceptedTerms: true,
};

async function place(s: Setup) {
  const res = await s.app.request(`${base}/orders`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(order),
  });
  return placedOrderSchema.parse(await res.json());
}

const paySaved = (s: Setup, orderId: string, orderToken: string, member: string, pm: string) =>
  s.app.request(`${base}/orders/${orderId}/payment/saved-card`, {
    method: 'POST',
    headers: { ...json, ...bearer(orderToken), 'X-Member-Token': member },
    body: JSON.stringify({ paymentMethodId: pm, returnUrl: 'https://bella.example.fr/commande' }),
  });

describe('cartes enregistrées', () => {
  it('exige une session de membre', async () => {
    const s = setup();
    expect((await s.app.request(`${base}/loyalty/me/cards`)).status).toBe(401);
    expect((await s.app.request(`${base}/loyalty/me/cards/setup`, { method: 'POST' })).status).toBe(
      401,
    );
  });

  it('ajoute, liste, choisit la carte par défaut et supprime', async () => {
    const s = setup();
    const token = await join(s);
    expect(await listCards(s, token)).toEqual([]);
    const customer = await addCard(s, token, 'pm_visa1');
    // Un deuxième ajout réutilise le même client Stripe.
    expect(await addCard(s, token, 'pm_master2', '4444')).toBe(customer);
    expect((await listCards(s, token)).map((c) => c.last4)).toEqual(['4242', '4444']);

    const def = await s.app.request(`${base}/loyalty/me/cards/pm_master2/default`, {
      method: 'POST',
      headers: bearer(token),
    });
    expect(def.status).toBe(204);
    expect((await listCards(s, token)).find((c) => c.isDefault)?.id).toBe('pm_master2');

    const del = await s.app.request(`${base}/loyalty/me/cards/pm_visa1`, {
      method: 'DELETE',
      headers: bearer(token),
    });
    expect(del.status).toBe(204);
    expect((await listCards(s, token)).map((c) => c.id)).toEqual(['pm_master2']);
  });

  it('un membre ne voit, ne supprime ni n’utilise les cartes d’un autre', async () => {
    const s = setup();
    const camille = await join(s);
    const autre = await join(s, 'autre@example.fr');
    await addCard(s, camille, 'pm_camille');
    expect(await listCards(s, autre)).toEqual([]);
    const del = await s.app.request(`${base}/loyalty/me/cards/pm_camille`, {
      method: 'DELETE',
      headers: bearer(autre),
    });
    expect(del.status).toBe(404);
    expect(await listCards(s, camille)).toHaveLength(1);

    const o = await place(s);
    const res = await paySaved(s, o.orderId, o.accessToken, autre, 'pm_camille');
    expect(res.status).toBe(404);
    expect(s.cards.payments).toEqual([]);
  });

  it('un jeton de membre d’une autre enseigne est refusé', async () => {
    const s = setup();
    const token = await join(s);
    const res = await s.app.request('/v1/tenants/greenbowl/loyalty/me/cards', {
      headers: bearer(token),
    });
    expect(res.status).toBe(401);
  });

  it('paie une commande avec une carte enregistrée ; « payée » seulement par le webhook', async () => {
    const s = setup();
    const token = await join(s);
    await addCard(s, token, 'pm_visa1');
    const o = await place(s);
    const res = await paySaved(s, o.orderId, o.accessToken, token, 'pm_visa1');
    expect(res.status).toBe(200);
    const body = savedCardPaymentSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'succeeded', stripeAccountId: 'acct_bella' });
    expect(s.cards.payments).toEqual([
      { paymentIntentId: 'pi_fake_1', account: 'acct_bella', card: 'pm_visa1' },
    ]);
    // Le montant vient du PaymentIntent créé par le serveur, jamais du client.
    expect(s.stripe.created[0]).toMatchObject({ amountCents: 1450, account: 'acct_bella' });
    expect(s.backend.orders[0]?.status).toBe('pending_payment');
  });

  it('renvoie « requires_action » pour une authentification 3-D Secure', async () => {
    const s = setup();
    const token = await join(s);
    await addCard(s, token, 'pm_3ds');
    s.cards.setNextStatus('requires_action');
    const o = await place(s);
    const body = savedCardPaymentSchema.parse(
      await (await paySaved(s, o.orderId, o.accessToken, token, 'pm_3ds')).json(),
    );
    expect(body.status).toBe('requires_action');
    expect(body.clientSecret).toMatch(/secret/);
  });

  it('refuse sans jeton de commande, sans jeton de membre ou avec un identifiant invalide', async () => {
    const s = setup();
    const token = await join(s);
    await addCard(s, token, 'pm_visa1');
    const o = await place(s);
    expect((await paySaved(s, o.orderId, 'x'.repeat(43), token, 'pm_visa1')).status).toBe(404);
    expect((await paySaved(s, o.orderId, o.accessToken, 'faux', 'pm_visa1')).status).toBe(401);
    expect((await paySaved(s, o.orderId, o.accessToken, token, 'pas-une-carte')).status).toBe(400);
  });

  it('sans Stripe : liste vide et ajout indisponible', async () => {
    const s = setup({ cardGateway: undefined, stripeCustomers: undefined });
    const token = await join(s);
    expect(await listCards(s, token)).toEqual([]);
    const res = await s.app.request(`${base}/loyalty/me/cards/setup`, {
      method: 'POST',
      headers: bearer(token),
    });
    expect(res.status).toBe(503);
  });
});
