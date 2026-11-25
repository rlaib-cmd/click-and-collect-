import { randomUUID } from 'node:crypto';
import { cents } from '@splash360/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOrderingStore, createPostgresOrderReader } from './ordering';
import { createPostgresPaymentStore } from './payments';
import { createPostgresRestaurantStore } from './restaurants';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('PaymentStore Postgres', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const ordering = createPostgresOrderingStore(sql);
  const payments = createPostgresPaymentStore(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.orders where idempotency_key like ${`pay-${run}-%`}`;
    await sql.end();
  });

  async function newOrder(key: string) {
    const [r] = await restaurants.listByTenant(BELLA);
    const result = await ordering.createOrder({
      id: randomUUID(),
      tenantId: BELLA,
      restaurantId: r?.id ?? '',
      customer: {
        name: 'Test',
        email: `pay-${run}@example.fr`,
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
          productId: 'p-tiramisu',
          name: 'Tiramisu',
          quantity: 2,
          basePriceCents: cents(650),
          options: [],
          unitPriceCents: cents(650),
          totalCents: cents(1300),
          note: null,
        },
      ],
      totals: {
        subtotalCents: cents(1300),
        deliveryFeeCents: cents(0),
        serviceFeeCents: cents(0),
        discountCents: cents(0),
        promoDiscountCents: cents(0),
        totalCents: cents(1300),
      },
      idempotencyKey: `pay-${run}-${key}`,
      applicationFeeCents: 33,
      accessTokenHash: 'empreinte',
      maxOrdersPerSlot: null,
    });
    if (!result.ok) throw new Error('création impossible');
    return result.order.id;
  }

  it('passe une commande à « payée » une seule fois, montant vérifié', async () => {
    const id = await newOrder('a');
    expect(await payments.getOrder(GREEN, id)).toBeNull();
    expect(await payments.attachPaymentIntent(BELLA, id, `pi_${run}_a`)).toBe(true);
    expect(await payments.markPaid(`pi_${run}_a`, 1299, 'eur')).toEqual({
      ok: false,
      error: 'amount_mismatch',
    });
    expect(await payments.markPaid(`pi_${run}_a`, 1300, 'eur')).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await payments.markPaid(`pi_${run}_a`, 1300, 'eur')).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await payments.getOrder(BELLA, id)).toMatchObject({
      status: 'paid',
      applicationFeeCents: 33,
    });
    expect(await payments.markPaid('pi_inconnu', 1300, 'eur')).toEqual({
      ok: false,
      error: 'unknown_payment',
    });
  });

  it('rembourse partiellement puis totalement, sans dépasser le total', async () => {
    const id = await newOrder('b');
    expect(await payments.recordRefund(BELLA, id, 500, 'admin', 'r0')).toEqual({
      ok: false,
      error: 'not_refundable',
    });
    await payments.attachPaymentIntent(BELLA, id, `pi_${run}_b`);
    await payments.markPaid(`pi_${run}_b`, 1300, 'eur');
    expect(await payments.recordRefund(BELLA, id, 500, 'admin', 'r1')).toEqual({
      ok: true,
      refundedCents: 500,
      fullyRefunded: false,
    });
    // Double clic : la même demande n'est pas comptée deux fois.
    expect(await payments.recordRefund(BELLA, id, 500, 'admin', 'r1')).toEqual({
      ok: true,
      refundedCents: 500,
      fullyRefunded: false,
    });
    expect(await payments.hasRefundRequest(BELLA, id, 'r1')).toBe(true);
    expect(await payments.hasRefundRequest(BELLA, id, 'autre')).toBe(false);
    expect(await payments.recordRefund(BELLA, id, 900, 'admin', 'r2')).toEqual({
      ok: false,
      error: 'amount_too_high',
    });
    expect(await payments.recordRefund(BELLA, id, 800, 'admin', 'r3')).toEqual({
      ok: true,
      refundedCents: 1300,
      fullyRefunded: true,
    });
    expect((await payments.getOrder(BELLA, id))?.status).toBe('refunded');
  });

  it('annule les commandes non payées à temps et note l’échec de paiement', async () => {
    const id = await newOrder('c');
    await payments.attachPaymentIntent(BELLA, id, `pi_${run}_c`);
    expect(await payments.markPaymentFailed(`pi_${run}_c`)).toMatchObject({
      ok: true,
      changed: true,
    });
    const expired = await payments.expirePending(new Date(Date.now() + 1000));
    expect(expired.map((e) => e.orderId)).toContain(id);
    expect((await payments.getOrder(BELLA, id))?.status).toBe('cancelled');
    // Un paiement qui aboutit malgré tout rattrape la commande.
    expect(await payments.markPaid(`pi_${run}_c`, 1300, 'eur')).toMatchObject({
      ok: true,
      changed: true,
    });
  });

  it('ne repasse pas à « payée » une commande annulée par l’équipe (avis Stripe tardif)', async () => {
    const id = await newOrder('d');
    await payments.attachPaymentIntent(BELLA, id, `pi_${run}_d`);
    await sql`update public.orders set status = 'cancelled' where id = ${id}`;
    await sql`insert into public.order_events (tenant_id, order_id, status, actor)
              values (${BELLA}, ${id}, 'cancelled', 'admin:equipe')`;
    expect(await payments.markPaid(`pi_${run}_d`, 1300, 'eur')).toMatchObject({
      ok: true,
      changed: false,
    });
    expect((await payments.getOrder(BELLA, id))?.status).toBe('cancelled');
  });
});

describe.skipIf(!url)('OrderReader Postgres', () => {
  const sql = createSql(url ?? '', { max: 2 });
  afterAll(() => sql.end());

  it('lit le détail d’une commande, jamais celui d’une autre enseigne', async () => {
    const reader = createPostgresOrderReader(sql);
    const [any] = await sql<
      { id: string }[]
    >`select id from public.orders where tenant_id = ${BELLA} limit 1`;
    if (!any) return;
    const detail = await reader.getOrderDetail(BELLA, any.id);
    expect(detail?.lines.length).toBeGreaterThan(0);
    expect(detail?.events[0]?.status).toBe('pending_payment');
    expect(await reader.getOrderDetail(GREEN, any.id)).toBeNull();
  });
});
