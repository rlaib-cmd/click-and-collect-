import { randomUUID } from 'node:crypto';
import { cents } from '@splash360/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOrderingStore, type NewOrder } from './ordering';
import { createPostgresRestaurantStore } from './restaurants';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('OrderingStore Postgres', () => {
  const sql = createSql(url ?? '', { max: 10 });
  const store = createPostgresOrderingStore(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.orders where idempotency_key like ${`test-${run}-%`}`;
    await sql.end();
  });

  async function bellaId() {
    const [r] = await restaurants.listByTenant(BELLA);
    if (!r) throw new Error('Données de démo absentes');
    return r.id;
  }

  const newOrder = (
    restaurantId: string,
    key: string,
    slot: string,
    max: number | null,
  ): NewOrder => ({
    id: randomUUID(),
    tenantId: BELLA,
    restaurantId,
    customer: {
      name: 'Test',
      email: `test-${run}@example.fr`,
      phone: '0600000000',
      marketingConsent: false,
    },
    mode: 'pickup',
    requestedSlot: slot,
    estimatedAt: slot,
    deliveryAddress: null,
    deliveryZoneId: null,
    lines: [
      {
        productId: 'p-margherita',
        name: 'Margherita',
        quantity: 2,
        basePriceCents: cents(1050),
        options: [
          { optionId: 'opt-grande', groupId: 'grp-taille', name: 'Grande', priceCents: cents(400) },
        ],
        unitPriceCents: cents(1450),
        totalCents: cents(2900),
        note: null,
      },
    ],
    totals: {
      subtotalCents: cents(2900),
      deliveryFeeCents: cents(0),
      serviceFeeCents: cents(0),
      discountCents: cents(0),
      totalCents: cents(2900),
    },
    idempotencyKey: `test-${run}-${key}`,
    applicationFeeCents: 0,
    accessTokenHash: 'empreinte',
    maxOrdersPerSlot: max,
  });

  it('paiement sur place : commande confirmée et envoyée en caisse dans la même transaction', async () => {
    const restaurantId = await bellaId();
    const slot = '2030-01-15T11:00:00.000Z';
    // Réservé aux membres : refusé par la base sans compte fidélité.
    await expect(
      store.createOrder({
        ...newOrder(restaurantId, 'sur-place-0', slot, null),
        paymentMethod: 'on_site',
      }),
    ).rejects.toThrow();
    const created = await store.createOrder({
      ...newOrder(restaurantId, 'sur-place-1', slot, null),
      paymentMethod: 'on_site',
      loyalty: { memberId: 'membre-test', reward: null },
    });
    if (!created.ok) throw new Error('commande refusée');
    expect(created.order.status).toBe('confirmed');
    const [row] = await sql<{ payment_method: string; dispatches: number }[]>`
      select o.payment_method, (select count(*)::int from public.pos_dispatches d where d.order_id = o.id) as dispatches
      from public.orders o where o.id = ${created.order.id}`;
    expect(row).toEqual({ payment_method: 'on_site', dispatches: 1 });
    // Une commande sur place ne peut jamais passer « payée ».
    await expect(
      sql`update public.orders set status = 'paid' where id = ${created.order.id}`,
    ).rejects.toThrow();
  });

  it('lit les réglages de commande du restaurant', async () => {
    const config = await store.getConfig(BELLA, await bellaId());
    expect(config).toMatchObject({
      pickupEnabled: true,
      deliveryEnabled: true,
      schedule: { slotStepMinutes: 15, maxOrdersPerSlot: 4, timezone: 'Europe/Paris' },
      fees: { deliveryMinimumCents: 1500, freeDeliveryThresholdCents: 3500 },
    });
    expect(config?.schedule.openingHours).toContainEqual({
      isoWeekday: 2,
      opens: '11:30',
      closes: '14:30',
    });
    expect(config?.zones).toHaveLength(2);
    expect(await store.getConfig(GREEN, await bellaId())).toBeNull();
  });

  it('enregistre la commande, ses lignes, options et historique ; rejoue la même clé', async () => {
    const id = await bellaId();
    const slot = '2030-01-08T11:00:00.000Z';
    const first = await store.createOrder(newOrder(id, 'a', slot, null));
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      order: { status: 'pending_payment', totalCents: 2900 },
    });
    const again = await store.createOrder(newOrder(id, 'a', slot, null));
    expect(again).toMatchObject({ ok: true, replayed: true });
    if (!first.ok || !again.ok) return;
    expect(again.order.id).toBe(first.order.id);

    const [row] = await sql<{ items: number; options: number; events: number }[]>`
      select (select count(*) from public.order_items where order_id = ${first.order.id})::int as items,
             (select count(*) from public.order_item_options o join public.order_items i on i.id = o.order_item_id
               where i.order_id = ${first.order.id})::int as options,
             (select count(*) from public.order_events where order_id = ${first.order.id})::int as events`;
    expect(row).toEqual({ items: 1, options: 1, events: 1 });
    expect(await store.slotLoad(id, new Date(slot), new Date(slot))).toEqual({ [slot]: 1 });
  });

  it('ne survend pas un créneau sous commandes simultanées', async () => {
    const id = await bellaId();
    const slot = '2030-01-09T11:00:00.000Z';
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => store.createOrder(newOrder(id, `c${i}`, slot, 2))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok)).toHaveLength(4);
  });

  it('réservations de points : commandes avec cadeau non réglées, hors rejeu de la même clé', async () => {
    const restaurantId = await bellaId();
    const slot = '2030-01-16T11:00:00.000Z';
    const memberId = `membre-${run}`;
    const withReward = (key: string): NewOrder => {
      const base = newOrder(restaurantId, key, slot, null);
      return {
        ...base,
        totals: { ...base.totals, discountCents: cents(1050), totalCents: cents(1850) },
        paymentMethod: 'on_site',
        loyalty: {
          memberId,
          reward: { id: 'rw-pizza', costPoints: 900, productId: 'p-margherita' },
        },
      };
    };
    const a = await store.createOrder(withReward('cadeau-a'));
    if (!a.ok) throw new Error('commande refusée');
    expect(await store.rewardHolds(BELLA, memberId, null)).toEqual([
      { status: 'confirmed', points: 900, createdAt: expect.any(Date) as Date },
    ]);
    // La même commande rejouée ne se réserve pas elle-même.
    expect(await store.rewardHolds(BELLA, memberId, `test-${run}-cadeau-a`)).toEqual([]);
    // Réglée chez Splash360 : plus de réservation.
    await sql`update public.orders set loyalty_settled_at = now() where id = ${a.order.id}`;
    expect(await store.rewardHolds(BELLA, memberId, null)).toEqual([]);
    // Une autre enseigne ne voit rien.
    expect(await store.rewardHolds(GREEN, memberId, null)).toEqual([]);
    // « Mes commandes » (lot 11) : la commande du membre, avec ses articles et son restaurant.
    const history = await store.memberOrders(BELLA, memberId, { limit: 10, beforeNumber: null });
    expect(history.map((o) => o.id)).toContain(a.order.id);
    expect(history[0]).toMatchObject({ paymentMethod: 'on_site', status: 'confirmed' });
    expect(history[0]?.items.length).toBeGreaterThan(0);
    expect(
      await store.memberOrders(BELLA, memberId, { limit: 10, beforeNumber: a.order.number }),
    ).toEqual([]);
    expect(await store.memberOrders(GREEN, memberId, { limit: 10, beforeNumber: null })).toEqual(
      [],
    );
  });

  it('client sans e-mail : reconnu par son téléphone, sans doublon', async () => {
    const restaurantId = await bellaId();
    const slot = '2030-01-17T11:00:00.000Z';
    const phone = `06 ${run.slice(-8).replace(/(\d\d)(?=\d)/g, '$1 ')}`;
    const noEmail = (key: string): NewOrder => {
      const base = newOrder(restaurantId, key, slot, null);
      return { ...base, customer: { ...base.customer, email: null, phone } };
    };
    const first = await store.createOrder(noEmail('sans-mail-1'));
    const second = await store.createOrder(noEmail('sans-mail-2'));
    if (!first.ok || !second.ok) throw new Error('commande refusée');
    const rows = await sql<{ customer_id: string; email: string | null; contact_key: string }[]>`
      select o.customer_id, c.email, c.contact_key from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.id in ${sql([first.order.id, second.order.id])}`;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.customer_id).toBe(rows[1]?.customer_id);
    expect(rows[0]?.email).toBeNull();
    expect(rows[0]?.contact_key).toMatch(/^tel:\+336\d{8}$/);
  });
});
