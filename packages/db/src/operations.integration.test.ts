import { randomUUID } from 'node:crypto';
import { cents } from '@splash360/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOperationsStore } from './operations';
import { createPostgresOrderingStore } from './ordering';
import { createPostgresPaymentStore } from './payments';
import { createPostgresRestaurantStore } from './restaurants';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('OperationsStore Postgres', () => {
  const sql = createSql(url ?? '', { max: 6 });
  const ordering = createPostgresOrderingStore(sql);
  const payments = createPostgresPaymentStore(sql);
  const ops = createPostgresOperationsStore(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.orders where idempotency_key like ${`ops-${run}-%`}`;
    await sql.end();
  });

  async function paidOrder(key: string) {
    const [r] = await restaurants.listByTenant(BELLA);
    const id = randomUUID();
    await ordering.createOrder({
      id,
      tenantId: BELLA,
      restaurantId: r?.id ?? '',
      customer: {
        name: 'Test',
        email: `ops-${run}@example.fr`,
        phone: '0600000000',
        marketingConsent: false,
      },
      mode: 'pickup',
      requestedSlot: null,
      estimatedAt: new Date().toISOString(),
      deliveryAddress: null,
      deliveryZoneId: null,
      lines: [
        {
          productId: 'p-eau',
          name: 'Eau',
          quantity: 1,
          basePriceCents: cents(350),
          options: [],
          unitPriceCents: cents(350),
          totalCents: cents(350),
          note: null,
        },
      ],
      totals: {
        subtotalCents: cents(350),
        deliveryFeeCents: cents(0),
        serviceFeeCents: cents(0),
        discountCents: cents(0),
        promoDiscountCents: cents(0),
        catalogDiscountCents: cents(0),
        catalogFeeCents: cents(0),
        totalCents: cents(350),
      },
      idempotencyKey: `ops-${run}-${key}`,
      applicationFeeCents: 0,
      accessTokenHash: 'empreinte',
      maxOrdersPerSlot: null,
    });
    await payments.attachPaymentIntent(BELLA, id, `pi_ops_${run}_${key}`);
    await payments.markPaid(`pi_ops_${run}_${key}`, 350, 'eur');
    return id;
  }

  it('crée l’envoi à la caisse au paiement et ne le donne qu’à une seule instance', async () => {
    const id = await paidOrder('a');
    const claims = await Promise.all([
      ops.claimDueDispatches(50),
      ops.claimDueDispatches(50),
      ops.claimDueDispatches(50),
    ]);
    const mine = claims.flat().filter((d) => d.orderId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ tenantId: BELLA, attempts: 1 });
    await ops.markDispatched(id, `POS-${run}-A`);
    expect(await ops.findByPosReference(`POS-${run}-A`)).toEqual({ tenantId: BELLA, orderId: id });
  });

  it('remonte un envoi abandonné et permet de le relancer', async () => {
    const id = await paidOrder('b');
    await ops.markDispatchFailed(id, 'Caisse injoignable', null);
    expect((await ops.listFailedDispatches(BELLA)).map((f) => f.orderId)).toContain(id);
    expect(await ops.listFailedDispatches(GREEN)).toEqual([]);
    expect(await ops.retryDispatch(GREEN, id)).toBe(false);
    expect(await ops.retryDispatch(BELLA, id)).toBe(true);
  });

  it('applique la machine à états et trace l’auteur', async () => {
    const id = await paidOrder('c');
    expect(await ops.changeStatus(BELLA, id, 'preparing', 'pos')).toMatchObject({
      ok: true,
      from: 'paid',
    });
    expect(await ops.changeStatus(BELLA, id, 'accepted', 'staff:1')).toEqual({
      ok: false,
      error: 'backwards',
    });
    expect(await ops.changeStatus(GREEN, id, 'ready', 'staff:1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    const [e] = await sql<
      { actor: string }[]
    >`select actor from public.order_events where order_id = ${id} and status = 'preparing'`;
    expect(e?.actor).toBe('pos');
  });

  it('enregistre un jeton de notification valide, refuse un jeton d’une autre enseigne', async () => {
    const id = await paidOrder('d');
    await ops.addPushToken(BELLA, id, 'ExponentPushToken[abc123]');
    await ops.addPushToken(BELLA, id, 'ExponentPushToken[abc123]');
    expect(await ops.listPushTokens(BELLA, id)).toEqual(['ExponentPushToken[abc123]']);
    await expect(ops.addPushToken(GREEN, id, 'ExponentPushToken[xyz]')).rejects.toThrow();
    await expect(ops.addPushToken(BELLA, id, 'pas-un-jeton')).rejects.toThrow();
  });
});
