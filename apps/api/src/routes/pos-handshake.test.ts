import {
  apiErrorSchema,
  placedOrderSchema,
  posReadinessSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { createDemoPosGateway, type PosGateway, type PosTicketState } from '../pos/gateway';
import { BELLA_ID, BELLA_RESTO, NOW, testSetup } from '../test-fixtures';

/**
 * Lot 14 (ADR 0018) : la caisse doit déclarer la commande « prête » avant tout paiement,
 * puis la confirmer après l'envoi du paiement ; sinon annulation ou remboursement automatique.
 */
const json = { 'Content-Type': 'application/json' };
const request: PlaceOrderRequest = {
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
  lines: [{ productId: 'p-tiramisu', quantity: 2, optionIds: [] }],
  customer: {
    name: 'Camille Martin',
    email: 'camille@example.fr',
    phone: '0612345678',
    marketingConsent: false,
  },
  idempotencyKey: 'cle-poignee-0000000001',
  acceptedTerms: true,
};

/** Horloge réglable et caisse de démonstration qui s'appuie dessus. */
function clocked(options: { readyAfterMs?: number; confirmAfterMs?: number } = {}) {
  let t = NOW.getTime();
  const now = () => new Date(t);
  const pos = createDemoPosGateway({ now, readyAfterMs: 2000, confirmAfterMs: 0, ...options });
  return { now, pos, advance: (ms: number) => (t += ms) };
}

/** Caisse scriptée : états successifs renvoyés par `ticketStatus`, appels comptés. */
function scripted(states: (phase: 'before' | 'after') => PosTicketState) {
  const calls = { open: 0, status: 0, pay: [] as unknown[] };
  const pos: PosGateway = {
    openTicket(order) {
      calls.open += 1;
      return Promise.resolve({ ticketId: `T-${order.number}` });
    },
    ticketStatus({ paymentSentAt }) {
      calls.status += 1;
      const state = states(paymentSentAt ? 'after' : 'before');
      return Promise.resolve({ state, raw: state });
    },
    submitPayment(_ticket, payment) {
      calls.pay.push(payment);
      return Promise.resolve();
    },
  };
  return { pos, calls };
}

async function place(setup: ReturnType<typeof testSetup>) {
  const res = await setup.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(request),
  });
  expect(res.status).toBe(201);
  const order = placedOrderSchema.parse(await res.json());
  const auth = { Authorization: `Bearer ${order.accessToken}` };
  const readiness = async () =>
    posReadinessSchema.parse(
      await (
        await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/pos-readiness`, {
          headers: auth,
        })
      ).json(),
    ).state;
  const pay = () =>
    setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/payment`, {
      method: 'POST',
      headers: auth,
    });
  const webhook = (paymentIntentId: string) =>
    setup.app.request('/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'whsec_test' },
      body: JSON.stringify({
        type: 'payment_succeeded',
        paymentIntentId,
        amountCents: order.totals.totalCents,
        currency: 'eur',
      }),
    });
  return { order, auth, readiness, pay, webhook };
}

describe('avant paiement : la caisse doit être prête', () => {
  it('fait attendre le paiement jusqu’à « ready », puis l’autorise', async () => {
    const c = clocked();
    const setup = testSetup({ pos: c.pos, now: c.now });
    const { order, readiness, pay } = await place(setup);
    // Rien n'est déposé en caisse tant que le client n'est pas sur le point de payer.
    expect(c.pos.submitted).toEqual([]);

    expect(await readiness()).toBe('waiting');
    expect(c.pos.submitted).toEqual([order.orderId]);
    const early = await pay();
    expect(early.status).toBe(409);
    expect(apiErrorSchema.parse(await early.json()).error.code).toBe('pos_not_ready');
    expect(setup.stripe.created).toEqual([]); // aucun paiement créé

    c.advance(2500);
    expect(await readiness()).toBe('ready');
    expect((await pay()).status).toBe(200);
    expect(setup.stripe.created).toHaveLength(1);
    expect(setup.backend.orders[0]?.pos).toMatchObject({ phase: 'ready' });
  });

  it('n’interroge pas la caisse plus d’une fois par seconde', async () => {
    const c = clocked();
    const s = scripted(() => 'pending');
    const setup = testSetup({ pos: s.pos, now: c.now });
    const { readiness } = await place(setup);
    await readiness();
    await readiness();
    await readiness();
    expect(s.calls.status).toBe(1);
    c.advance(1000);
    await readiness();
    expect(s.calls.status).toBe(2);
  });

  it('annule la commande si la caisse ne répond pas « ready » à temps', async () => {
    const c = clocked();
    const s = scripted(() => 'pending');
    const setup = testSetup({ pos: s.pos, now: c.now });
    const { readiness, pay } = await place(setup);
    expect(await readiness()).toBe('waiting');
    c.advance(61_000);
    expect(await readiness()).toBe('unavailable');
    expect(setup.backend.orders[0]?.status).toBe('cancelled');
    expect(setup.backend.orders[0]?.events.at(-1)).toMatchObject({
      status: 'cancelled',
      actor: 'pos',
    });
    expect((await pay()).status).toBe(409);
    expect(setup.stripe.created).toEqual([]);
  });

  it('annule la commande si la caisse la refuse ou est injoignable', async () => {
    const refused = testSetup({ pos: scripted(() => 'failed').pos });
    const a = await place(refused);
    expect(await a.readiness()).toBe('unavailable');
    expect(refused.backend.orders[0]?.status).toBe('cancelled');

    const down: PosGateway = {
      openTicket: () => Promise.reject(new Error('Caisse injoignable')),
      ticketStatus: () => Promise.reject(new Error('non utilisé')),
      submitPayment: () => Promise.reject(new Error('non utilisé')),
    };
    const unreachable = testSetup({ pos: down });
    const b = await place(unreachable);
    expect(await b.readiness()).toBe('unavailable');
    expect(unreachable.backend.orders[0]?.status).toBe('cancelled');
    expect((await b.pay()).status).toBe(409);
  });

  it('ne dépose rien en caisse si le paiement en ligne est impossible', async () => {
    const s = scripted(() => 'ready');
    const setup = testSetup({ pos: s.pos, gateway: null });
    const { readiness, pay } = await place(setup);
    expect(await readiness()).toBe('ready');
    expect(s.calls.open).toBe(0);
    expect((await pay()).status).toBe(503);
  });

  it('exige le jeton de suivi', async () => {
    const setup = testSetup();
    const { order } = await place(setup);
    const res = await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/pos-readiness`);
    expect(res.status).toBe(404);
  });
});

describe('après paiement : envoi du paiement puis confirmation', () => {
  it('notifie le paiement par carte avec la référence Stripe et attend « confirmed »', async () => {
    const s = scripted((phase) => (phase === 'after' ? 'confirmed' : 'ready'));
    const setup = testSetup({ pos: s.pos });
    const { readiness, pay, webhook } = await place(setup);
    expect(await readiness()).toBe('ready');
    expect((await pay()).status).toBe(200);
    await webhook('pi_fake_1');
    expect(s.calls.pay).toEqual([
      {
        method: 'card',
        amountCents: setup.backend.orders[0]?.totals.totalCents,
        reference: 'pi_fake_1',
      },
    ]);
    expect(setup.backend.orders[0]).toMatchObject({
      status: 'paid',
      posReference: 'T-1001',
      pos: { phase: 'confirmed' },
    });
    expect([...setup.backend.dispatches.values()][0]?.status).toBe('sent');
  });

  it('attend la confirmation sans compter d’échec, puis rembourse si elle ne vient pas', async () => {
    const c = clocked();
    const s = scripted(() => 'ready'); // la caisse ne confirme jamais
    const setup = testSetup({ pos: s.pos, now: c.now });
    const { readiness, pay, webhook } = await place(setup);
    expect(await readiness()).toBe('ready');
    await pay();
    await webhook('pi_fake_1');
    const dispatch = [...setup.backend.dispatches.values()][0];
    expect(dispatch).toMatchObject({ status: 'pending', attempts: 0 }); // simple attente
    expect(setup.backend.orders[0]?.pos?.phase).toBe('payment_sent');

    if (dispatch) dispatch.nextAt = 0;
    c.advance(60_000);
    await setup.app.runDispatches();
    expect(dispatch).toMatchObject({ status: 'pending', attempts: 0 });
    expect(s.calls.pay).toHaveLength(1); // le paiement n'est jamais renvoyé

    if (dispatch) dispatch.nextAt = 0;
    c.advance(5 * 60_000);
    await setup.app.runDispatches();
    expect(dispatch?.status).toBe('failed'); // alerte au back-office
    expect(setup.stripe.refunds).toEqual([
      {
        paymentIntentId: 'pi_fake_1',
        amountCents: setup.backend.orders[0]?.totals.totalCents,
        idempotencyKey: `refund-${setup.backend.orders[0]?.id}-pos-failed`,
        connectedAccountId: expect.any(String) as string,
      },
    ]);
    expect(setup.backend.orders[0]?.status).toBe('refunded');
    expect(setup.backend.orders[0]?.pos?.phase).toBe('failed');
    expect(setup.notifications.pushes.length + setup.notifications.emails.length).toBeGreaterThan(
      0,
    );
    const failed = await setup.deps.operations.listFailedDispatches(BELLA_ID);
    expect(failed[0]?.lastError).toContain('pas confirmé');
  });

  it('rembourse aussitôt si la caisse refuse le paiement', async () => {
    const s = scripted((phase) => (phase === 'after' ? 'failed' : 'ready'));
    const setup = testSetup({ pos: s.pos });
    const { readiness, pay, webhook } = await place(setup);
    await readiness();
    await pay();
    await webhook('pi_fake_1');
    expect(setup.stripe.refunds).toHaveLength(1);
    expect(setup.backend.orders[0]?.status).toBe('refunded');
  });
});
