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
      totalCents: cents(2900),
    },
    idempotencyKey: `test-${run}-${key}`,
    applicationFeeCents: 0,
    accessTokenHash: 'empreinte',
    maxOrdersPerSlot: max,
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
});
