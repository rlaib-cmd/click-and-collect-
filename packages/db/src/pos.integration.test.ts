import { randomUUID } from 'node:crypto';
import { cents } from '@splash360/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOrderReader, createPostgresOrderingStore } from './ordering';
import { createPostgresOperationsStore } from './operations';
import { createPostgresPaymentStore } from './payments';
import { createPostgresPosTicketStore } from './pos';
import { createPostgresRestaurantStore } from './restaurants';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('PosTicketStore Postgres (ADR 0018)', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const ordering = createPostgresOrderingStore(sql);
  const payments = createPostgresPaymentStore(sql);
  const tickets = createPostgresPosTicketStore(sql);
  const reader = createPostgresOrderReader(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const operations = createPostgresOperationsStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.orders where idempotency_key like ${`pos-${run}-%`}`;
    await sql.end();
  });

  async function newOrder(key: string, paid: boolean) {
    const [r] = await restaurants.listByTenant(BELLA);
    const id = randomUUID();
    await ordering.createOrder({
      id,
      tenantId: BELLA,
      restaurantId: r?.id ?? '',
      customer: {
        name: 'Test',
        email: `pos-${run}@example.fr`,
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
        totalCents: cents(350),
      },
      idempotencyKey: `pos-${run}-${key}`,
      applicationFeeCents: 0,
      accessTokenHash: 'empreinte',
      maxOrdersPerSlot: null,
    });
    if (!paid) return id;
    await payments.attachPaymentIntent(BELLA, id, `pi_pos_${run}_${key}`);
    await payments.markPaid(`pi_pos_${run}_${key}`, 350, 'eur');
    return id;
  }

  it('réserve le dépôt en caisse une seule fois (pas de ticket en double)', async () => {
    const id = await newOrder('reserve', false);
    const at = new Date();
    expect(await tickets.reserveOpening(BELLA, id, at)).toBe('reserved');
    expect(await tickets.reserveOpening(BELLA, id, new Date(at.getTime() + 1000))).toBe(
      'in_progress',
    );
    // Dépôt commencé sans ticket : jamais redéposé automatiquement (doublon en caisse).
    expect(await tickets.reserveOpening(BELLA, id, new Date(at.getTime() + 31_000))).toBe(
      'abandoned',
    );
    await tickets.openTicket(BELLA, id, `T-${run}-reserve`, at);
    expect(await tickets.reserveOpening(BELLA, id, new Date(at.getTime() + 90_000))).toBe(
      'in_progress',
    );
  });

  it('signale les commandes annulées ici mais peut-être « en attente » en caisse', async () => {
    const at = new Date();
    const standby = await newOrder('standby', false);
    await tickets.reserveOpening(BELLA, standby, at);
    await tickets.openTicket(BELLA, standby, `T-${run}-standby`, at);
    expect(await tickets.cancelForPos(BELLA, standby, 'payment_timeout')).toBe(true);
    const uncertain = await newOrder('uncertain', false);
    await tickets.reserveOpening(BELLA, uncertain, at);
    await tickets.cancelForPos(BELLA, uncertain, 'pos_uncertain');
    const never = await newOrder('never', false);
    await tickets.cancelForPos(BELLA, never, 'payment_timeout');
    const ids = (await operations.listPosToCancel(BELLA)).map((o) => o.orderId);
    expect(ids).toEqual(expect.arrayContaining([standby, uncertain]));
    expect(ids).not.toContain(never);
    expect(await operations.listPosToCancel(GREEN)).toEqual([]);
  });

  it('ne branche la caisse réelle que sur un seul restaurant à la fois', async () => {
    const [bella] = await restaurants.listByTenant(BELLA);
    const [green] = await restaurants.listByTenant(GREEN);
    if (!bella || !green) throw new Error('seed incomplet');
    try {
      expect(await restaurants.setSplash360Live(BELLA, bella.id, true)).toBe(true);
      expect(await restaurants.setSplash360Live(GREEN, green.id, true)).toBe(false);
      expect(await restaurants.setSplash360Live(BELLA, bella.id, true)).toBe(true);
    } finally {
      await restaurants.setSplash360Live(BELLA, bella.id, false);
    }
    expect(await restaurants.setSplash360Live(GREEN, green.id, true)).toBe(true);
    await restaurants.setSplash360Live(GREEN, green.id, false);
  });

  it('suit la poignée de main avec la caisse, par enseigne', async () => {
    const id = await newOrder('a', false);
    const t0 = new Date('2026-11-24T12:00:00Z');
    expect(await tickets.getTicket(BELLA, id)).toBeNull();
    expect(await tickets.openTicket(BELLA, id, `T-${run}-a`, t0)).toBe(true);
    expect(await tickets.openTicket(BELLA, id, `T-${run}-autre`, t0)).toBe(false);
    expect(await tickets.getTicket(GREEN, id)).toBeNull();
    await tickets.setPhase(BELLA, id, 'ready', new Date('2026-11-24T12:00:02Z'), {
      lastStatus: 'ready',
    });
    const ready = await tickets.getTicket(BELLA, id);
    expect(ready).toMatchObject({ ticketId: `T-${run}-a`, phase: 'ready', lastStatus: 'ready' });
    expect(ready?.readyAt?.toISOString()).toBe('2026-11-24T12:00:02.000Z');
  });

  it('annule une commande non payée refusée par la caisse, pas une commande payée', async () => {
    const unpaid = await newOrder('b', false);
    expect(await tickets.cancelForPos(BELLA, unpaid, 'pos_not_ready')).toBe(true);
    expect((await reader.getOrderDetail(BELLA, unpaid))?.status).toBe('cancelled');
    const paid = await newOrder('c', true);
    expect(await tickets.cancelForPos(BELLA, paid, 'pos_not_ready')).toBe(false);
  });

  it('remet un envoi en attente sans compter un échec, et expose les identifiants des lignes', async () => {
    const id = await newOrder('d', true);
    await tickets.deferDispatch(id, new Date(Date.now() + 60_000));
    const [d] = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from public.pos_dispatches where order_id = ${id}`;
    expect(d).toEqual({ status: 'pending', attempts: 0 });
    expect((await reader.getOrderDetail(BELLA, id))?.lines[0]?.productId).toBe('p-eau');
    const [r] = await restaurants.listByTenant(BELLA);
    expect(r?.splash360Live).toBe(false);
  });
});
