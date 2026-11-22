import {
  orderTrackingSchema,
  placedOrderSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { processDispatches } from '../pos/dispatcher';
import { PosRejectedError, signPosPayload, type PosGateway } from '../pos/gateway';
import { BELLA_ID, BELLA_RESTO, POS_SECRET, testSetup } from '../test-fixtures';

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
  idempotencyKey: 'cle-caisse-0000000001',
  acceptedTerms: true,
};

async function paidOrder(setup = testSetup()) {
  const res = await setup.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify(request),
  });
  const order = placedOrderSchema.parse(await res.json());
  const auth = { Authorization: `Bearer ${order.accessToken}` };
  await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/push-token`, {
    method: 'POST',
    headers: { ...auth, ...json },
    body: JSON.stringify({ token: 'ExponentPushToken[appareil-1]' }),
  });
  await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/payment`, {
    method: 'POST',
    headers: auth,
  });
  await setup.app.request('/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'whsec_test' },
    body: JSON.stringify({
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1300,
      currency: 'eur',
    }),
  });
  return { setup, order, auth };
}

const posStatus = (setup: ReturnType<typeof testSetup>, body: unknown, secret = POS_SECRET) => {
  const raw = JSON.stringify(body);
  return setup.app.request('/v1/pos/status', {
    method: 'POST',
    headers: { 'x-splash360-signature': signPosPayload(secret, raw) },
    body: raw,
  });
};

describe('après paiement', () => {
  it('envoie la commande à la caisse, envoie le reçu et notifie l’appareil', async () => {
    const { setup, order } = await paidOrder();
    expect(setup.pos.submitted).toEqual([order.orderId]);
    expect(setup.backend.orders[0]?.posReference).toMatch(/^DEMO-1001-/);
    expect(setup.notifications.emails).toHaveLength(1);
    expect(setup.notifications.emails[0]).toMatchObject({
      to: 'camille@example.fr',
      subject: expect.stringContaining('n° 1001'),
    });
    expect(setup.notifications.emails[0]?.text).toContain('Total payé : 13,00 €');
    expect(setup.notifications.pushes[0]).toMatchObject({
      tokens: ['ExponentPushToken[appareil-1]'],
      title: 'Pizzeria Bella · Commande confirmée',
    });
  });

  it('refuse un jeton de notification invalide ou sans jeton de suivi', async () => {
    const { setup, order, auth } = await paidOrder();
    const bad = await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/push-token`, {
      method: 'POST',
      headers: { ...auth, ...json },
      body: JSON.stringify({ token: 'nimporte-quoi' }),
    });
    expect(bad.status).toBe(400);
    const anonymous = await setup.app.request(
      `/v1/tenants/bella/orders/${order.orderId}/push-token`,
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ token: 'ExponentPushToken[x]' }),
      },
    );
    expect(anonymous.status).toBe(404);
  });
});

describe('retour des statuts de la caisse', () => {
  it('applique un statut signé, le trace et notifie le client', async () => {
    const { setup, order, auth } = await paidOrder();
    const reference = setup.backend.orders[0]?.posReference ?? '';
    expect(
      (
        await posStatus(
          setup,
          { reference, status: 'preparing' },
          'mauvais-secret-0000000000000000000',
        )
      ).status,
    ).toBe(401);
    expect(await (await posStatus(setup, { reference, status: 'preparing' })).json()).toEqual({
      received: true,
      outcome: 'applied',
    });
    expect(await (await posStatus(setup, { reference, status: 'accepted' })).json()).toEqual({
      received: true,
      outcome: 'backwards',
    });
    expect(await (await posStatus(setup, { reference, status: 'ready' })).json()).toEqual({
      received: true,
      outcome: 'applied',
    });

    const tracking = orderTrackingSchema.parse(
      await (
        await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}`, { headers: auth })
      ).json(),
    );
    expect(tracking.status).toBe('ready');
    expect(tracking.history.map((h) => h.status)).toEqual([
      'pending_payment',
      'paid',
      'preparing',
      'ready',
    ]);
    expect(setup.notifications.pushes.map((p) => p.title)).toEqual([
      'Pizzeria Bella · Commande confirmée',
      'Pizzeria Bella · En préparation',
      'Pizzeria Bella · Commande prête',
    ]);
    expect(setup.backend.orders[0]?.events.at(-1)?.actor).toBe('pos');
  });

  it('refuse une référence inconnue ou un statut hors contrat', async () => {
    const setup = testSetup();
    expect((await posStatus(setup, { reference: 'inconnue', status: 'ready' })).status).toBe(404);
    expect((await posStatus(setup, { reference: 'x', status: 'paid' })).status).toBe(400);
  });

  it('est désactivé sans secret partagé', async () => {
    const setup = testSetup({ posWebhookSecret: null });
    expect((await posStatus(setup, { reference: 'x', status: 'ready' })).status).toBe(503);
  });
});

describe('nouveaux essais vers la caisse', () => {
  it('réessaie puis abandonne au 3e échec avec alerte, relance manuelle possible', async () => {
    let calls = 0;
    const down: PosGateway = {
      submitOrder() {
        calls += 1;
        return Promise.reject(new Error('Caisse injoignable'));
      },
    };
    const { setup } = await paidOrder(testSetup({ pos: down }));
    const deps = {
      operations: setup.deps.operations,
      orders: setup.deps.orders,
      restaurants: setup.deps.restaurants,
      pos: down,
    };
    const dispatch = [...setup.backend.dispatches.values()][0];
    expect(dispatch).toMatchObject({ status: 'pending', attempts: 1 }); // 1er essai, juste après le paiement

    for (const attempt of [2, 3]) {
      if (dispatch) dispatch.nextAt = 0; // le délai est écoulé
      await processDispatches(deps);
      expect(dispatch?.attempts).toBe(attempt);
    }
    expect(calls).toBe(3);
    expect(dispatch?.status).toBe('failed');
    const failed = await setup.deps.operations.listFailedDispatches(BELLA_ID);
    expect(failed[0]).toMatchObject({ number: 1001, attempts: 3, lastError: 'Caisse injoignable' });
    expect(await setup.deps.operations.retryDispatch(BELLA_ID, failed[0]?.orderId ?? '')).toBe(
      true,
    );
  });

  it('abandonne tout de suite un refus définitif de la caisse', async () => {
    const refuses: PosGateway = {
      submitOrder: () =>
        Promise.reject(new PosRejectedError('Restaurant inconnu de la caisse', false)),
    };
    const { setup } = await paidOrder(testSetup({ pos: refuses }));
    expect([...setup.backend.dispatches.values()][0]).toMatchObject({
      status: 'failed',
      attempts: 1,
    });
  });
});
