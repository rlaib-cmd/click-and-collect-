import {
  orderTrackingSchema,
  paymentSessionSchema,
  placedOrderSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { createStripeGateway } from '../payments/gateway';
import { expireUnpaidOrders, refundOrder } from '../payments/service';
import { BELLA_ID, BELLA_RESTO, restaurants, testSetup } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };
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
  idempotencyKey: 'cle-paiement-000000001',
  acceptedTerms: true,
};

async function placed(setup = testSetup()) {
  const res = await setup.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(order),
  });
  return { setup, order: placedOrderSchema.parse(await res.json()) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const webhook = (setup: ReturnType<typeof testSetup>, event: unknown, signature = 'whsec_test') =>
  setup.app.request('/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: JSON.stringify(event),
  });

describe('jeton de suivi', () => {
  it('protège le suivi de commande', async () => {
    const { setup, order: o } = await placed();
    expect((await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}`)).status).toBe(404);
    expect(
      (
        await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}`, {
          headers: auth('x'.repeat(43)),
        })
      ).status,
    ).toBe(404);
    const res = await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}`, {
      headers: auth(o.accessToken),
    });
    const tracking = orderTrackingSchema.parse(await res.json());
    expect(tracking).toMatchObject({
      status: 'pending_payment',
      number: o.number,
      scheduled: true,
    });
    expect(tracking.lines[0]).toMatchObject({ name: 'Margherita', options: ['Grande (40 cm)'] });
  });

  it('redonne le même jeton en cas de renvoi idempotent', async () => {
    const { setup, order: first } = await placed();
    const again = await setup.app.request('/v1/tenants/bella/orders', {
      method: 'POST',
      headers: json,
      body: JSON.stringify(order),
    });
    expect(placedOrderSchema.parse(await again.json()).accessToken).toBe(first.accessToken);
  });

  it('ne donne pas accès à la commande depuis une autre enseigne', async () => {
    const { setup, order: o } = await placed();
    const res = await setup.app.request(`/v1/tenants/greenbowl/orders/${o.orderId}`, {
      headers: auth(o.accessToken),
    });
    expect(res.status).toBe(404);
  });
});

describe('session de paiement', () => {
  it('crée un paiement direct sur le compte du restaurant, commission comprise, une seule fois', async () => {
    const { setup, order: o } = await placed();
    const pay = () =>
      setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
        method: 'POST',
        headers: auth(o.accessToken),
      });
    const session = paymentSessionSchema.parse(await (await pay()).json());
    expect(session).toMatchObject({
      stripeAccountId: 'acct_bella',
      amountCents: 1450,
      publishableKey: 'pk_test_fake',
    });
    await pay();
    expect(setup.stripe.created).toEqual([
      // 2,5 % de 14,50 € = 36 centimes.
      {
        id: 'pi_fake_1',
        orderId: o.orderId,
        amountCents: 1450,
        applicationFeeCents: 36,
        account: 'acct_bella',
      },
    ]);
  });

  it('refuse sans jeton, sans Stripe, ou une commande déjà payée', async () => {
    const { setup, order: o } = await placed();
    expect(
      (await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, { method: 'POST' }))
        .status,
    ).toBe(404);

    const noStripe = await placed(testSetup({ gateway: null }));
    const res = await noStripe.setup.app.request(
      `/v1/tenants/bella/orders/${noStripe.order.orderId}/payment`,
      {
        method: 'POST',
        headers: auth(noStripe.order.accessToken),
      },
    );
    expect(res.status).toBe(503);

    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    await webhook(setup, {
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1450,
      currency: 'eur',
    });
    const again = await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    expect(again.status).toBe(409);
  });
});

describe('webhook Stripe', () => {
  it('seul un webhook signé fait passer la commande à « payée », une seule fois', async () => {
    const onPaid = vi.fn().mockResolvedValue(undefined);
    const { setup, order: o } = await placed(testSetup({ onPaid }));
    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    const event = {
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1450,
      currency: 'eur',
    };

    expect((await webhook(setup, event, 'mauvaise-signature')).status).toBe(400);
    expect(setup.backend.orders[0]?.status).toBe('pending_payment');

    expect(await (await webhook(setup, event)).json()).toEqual({
      received: true,
      outcome: 'processed',
    });
    expect(await (await webhook(setup, event)).json()).toEqual({
      received: true,
      outcome: 'duplicate',
    });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledWith({ orderId: o.orderId, tenantId: BELLA_ID });

    const tracking = orderTrackingSchema.parse(
      await (
        await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}`, {
          headers: auth(o.accessToken),
        })
      ).json(),
    );
    expect(tracking.status).toBe('paid');
    expect(tracking.history.map((h) => h.status)).toEqual(['pending_payment', 'paid']);
  });

  it('rejette un montant qui ne correspond pas à la commande', async () => {
    const { setup, order: o } = await placed();
    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    const res = await webhook(setup, {
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 100,
      currency: 'eur',
    });
    expect(await res.json()).toEqual({ received: true, outcome: 'rejected' });
    expect(setup.backend.orders[0]?.status).toBe('pending_payment');
  });

  it('note l’échec de paiement ; le client peut réessayer', async () => {
    const { setup, order: o } = await placed();
    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    await webhook(setup, { type: 'payment_failed', paymentIntentId: 'pi_fake_1' });
    expect(setup.backend.orders[0]?.status).toBe('payment_failed');
    const retry = await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    expect(retry.status).toBe(200);
  });

  it('vérifie les vraies signatures Stripe (SubtleCrypto, comme sur Supabase Edge)', async () => {
    const secret = 'whsec_cle_de_test';
    const gateway = createStripeGateway({
      secretKey: 'sk_test_x',
      publishableKey: 'pk_test_x',
      webhookSecret: secret,
    });
    const payload = JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: { id: 'pi_1', object: 'payment_intent', amount_received: 1450, currency: 'eur' },
      },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    await expect(gateway.parseWebhook(payload, header)).resolves.toEqual({
      type: 'payment_succeeded',
      paymentIntentId: 'pi_1',
      amountCents: 1450,
      currency: 'eur',
    });
    await expect(gateway.parseWebhook(payload, 't=1,v1=faux')).rejects.toThrow();
    await expect(gateway.parseWebhook(payload.replace('1450', '1'), header)).rejects.toThrow();
  });
});

describe('expiration et remboursement', () => {
  it('annule après 15 min sans paiement, libère le créneau et annule le paiement Stripe', async () => {
    const { setup, order: o } = await placed();
    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    const deps = { payments: setup.deps.payments, gateway: setup.deps.gateway };
    expect(await expireUnpaidOrders(deps, new Date(Date.now() + 14 * 60_000))).toBe(0);
    expect(await expireUnpaidOrders(deps, new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect(setup.backend.orders[0]?.status).toBe('cancelled');
    expect(setup.stripe.cancelled).toEqual(['pi_fake_1']);
  });

  it('rembourse partiellement puis totalement, tracé avec son auteur', async () => {
    const { setup, order: o } = await placed();
    await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    await webhook(setup, {
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1450,
      currency: 'eur',
    });
    const deps = { payments: setup.deps.payments, gateway: setup.deps.gateway };
    const base = { tenantId: BELLA_ID, orderId: o.orderId, actor: 'admin:42' };
    expect(await refundOrder(deps, { ...base, amountCents: 450, requestId: 'r1' })).toEqual({
      ok: true,
      refundedCents: 450,
      fullyRefunded: false,
    });
    expect(await refundOrder(deps, { ...base, amountCents: 1001, requestId: 'r2' })).toEqual({
      ok: false,
      error: 'amount_too_high',
    });
    expect(await refundOrder(deps, { ...base, amountCents: 1000, requestId: 'r3' })).toEqual({
      ok: true,
      refundedCents: 1450,
      fullyRefunded: true,
    });
    expect(setup.stripe.refunds.map((r) => r.idempotencyKey)).toEqual([
      `refund-${o.orderId}-r1`,
      `refund-${o.orderId}-r3`,
    ]);
    expect(setup.backend.orders[0]?.events.at(-1)).toMatchObject({
      status: 'refunded',
      actor: 'admin:42',
    });
  });
});

describe('compte Stripe du restaurant', () => {
  it('suit l’activation du compte via account.updated', async () => {
    const setup = testSetup();
    await webhook(setup, {
      type: 'account_updated',
      accountId: 'acct_bella',
      chargesEnabled: false,
    });
    const { order: o } = await placed(setup);
    const res = await setup.app.request(`/v1/tenants/bella/orders/${o.orderId}/payment`, {
      method: 'POST',
      headers: auth(o.accessToken),
    });
    expect(res.status).toBe(503);
    expect(restaurants[0]?.stripeChargesEnabled).toBe(true); // la donnée source n'est pas modifiée par les tests
  });
});
