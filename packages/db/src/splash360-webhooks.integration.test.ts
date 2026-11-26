import { randomUUID } from 'node:crypto';
import { cents } from '@splash360/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOperationsStore } from './operations';
import { createPostgresOrderReader, createPostgresOrderingStore } from './ordering';
import { createPostgresPosTicketStore } from './pos';
import { createPostgresRestaurantStore } from './restaurants';
import { createPostgresSplash360WebhookStore } from './splash360-webhooks';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('Webhooks Splash360 Postgres (lot 23)', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const store = createPostgresSplash360WebhookStore(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const operations = createPostgresOperationsStore(sql);
  const ordering = createPostgresOrderingStore(sql);
  const tickets = createPostgresPosTicketStore(sql);
  const reader = createPostgresOrderReader(sql);
  const run = `${Date.now()}`;
  const station = `st_${run}`;
  let bella = '';
  let green = '';

  beforeAll(async () => {
    bella = (await restaurants.listByTenant(BELLA))[0]?.id ?? '';
    green = (await restaurants.listByTenant(GREEN))[0]?.id ?? '';
  });

  afterAll(async () => {
    await sql`delete from splash360_private.webhook_receipts where webhook_id like ${`msg-${run}-%`}`;
    await sql`delete from public.menu_stock_overrides where source_webhook_id like ${`msg-${run}-%`}`;
    await sql`update public.restaurants set splash360_station_id = null
              where splash360_station_id like ${`st_${run}%`}`;
    await sql`delete from public.orders where idempotency_key like ${`wh-${run}-%`}`;
    await sql.end();
  });

  it('station : réglée, retrouvée, unique, effaçable', async () => {
    expect(await restaurants.setSplash360Station(BELLA, bella, station)).toBe('ok');
    expect((await restaurants.findBySplash360Station(station))?.id).toBe(bella);
    expect((await restaurants.findById(BELLA, bella))?.splash360StationId).toBe(station);
    expect(await restaurants.setSplash360Station(GREEN, green, station)).toBe('taken');
    // Restaurant d'une autre enseigne : introuvable.
    expect(await restaurants.setSplash360Station(GREEN, bella, `${station}x`)).toBe('not_found');
    expect(await restaurants.findBySplash360Station('pas valide !')).toBeNull();
    expect(await restaurants.setSplash360Station(BELLA, bella, null)).toBe('ok');
    expect(await restaurants.findBySplash360Station(station)).toBeNull();
    expect(await restaurants.setSplash360Station(BELLA, bella, station)).toBe('ok');
  });

  it('appels reçus : dédoublonnage, résultat, journal, purge', async () => {
    const at = new Date();
    const input = {
      webhookId: `msg-${run}-1`,
      event: 'stock' as const,
      stationId: station,
      tenantId: BELLA,
      restaurantId: bella,
      at,
    };
    expect(await store.claim(input)).toBe(true);
    expect(await store.claim(input)).toBe(false);
    await store.finish(input.webhookId, 'applied', { items: 2, unavailable: 1 }, at);
    expect(
      await store.claim({
        ...input,
        webhookId: `msg-${run}-2`,
        stationId: 'inconnue',
        tenantId: null,
        restaurantId: null,
        outcome: 'unknown_station',
        at: new Date(at.getTime() - 8 * 24 * 3_600_000),
      }),
    ).toBe(true);
    const recent = await store.recent(100);
    expect(recent.find((r) => r.webhookId === input.webhookId)).toMatchObject({
      outcome: 'applied',
      summary: { items: 2, unavailable: 1 },
      restaurantId: bella,
    });
    // Enseigne incohérente avec le restaurant : refusé par la base.
    await expect(
      store.claim({ ...input, webhookId: `msg-${run}-3`, tenantId: GREEN }),
    ).rejects.toThrow();
    expect(await store.purge(new Date(at.getTime() - 7 * 24 * 3_600_000))).toBeGreaterThanOrEqual(
      1,
    );
    expect((await store.recent(100)).some((r) => r.webhookId === `msg-${run}-2`)).toBe(false);
  });

  it('états de la caisse : disponibilité et prix, comptés, prix effacés au catalogue', async () => {
    const t0 = new Date(Date.now() - 60_000);
    await store.setAvailability(
      BELLA,
      bella,
      [
        { itemId: `prd${run}`, available: false },
        { itemId: `ing${run}-typ1`, available: true },
      ],
      `msg-${run}-4`,
      t0,
    );
    await store.setDeliveryPrices(
      BELLA,
      bella,
      [{ itemId: `prd${run}`, priceCents: 1350 }],
      `msg-${run}-5`,
      t0,
    );
    const overrides = await store.listOverrides(bella);
    expect(overrides.find((o) => o.itemId === `prd${run}`)).toMatchObject({
      available: false,
      deliveryPriceCents: 1350,
    });
    expect((await store.countOverrides(BELLA))[bella]).toMatchObject({
      unavailable: 1,
      deliveryPrices: 1,
    });
    expect(await store.countOverrides(GREEN)).not.toHaveProperty(bella);
    // Autre enseigne que celle du restaurant : refusé par la base.
    await expect(
      store.setAvailability(
        GREEN,
        bella,
        [{ itemId: 'prd1', available: false }],
        `msg-${run}-6`,
        t0,
      ),
    ).rejects.toThrow();
    // Catalogue installé après : prix propre effacé, disponibilité gardée.
    expect(await store.clearDeliveryPrices(BELLA, bella, new Date())).toBe(1);
    const after = await store.listOverrides(bella);
    expect(after.find((o) => o.itemId === `prd${run}`)).toMatchObject({
      available: false,
      deliveryPriceCents: null,
    });
    await store.setAvailability(
      BELLA,
      bella,
      [{ itemId: `prd${run}`, available: true }],
      `msg-${run}-7`,
      new Date(),
    );
    expect(
      (await store.listOverrides(bella)).find((o) => o.itemId === `prd${run}`)?.available,
    ).toBe(true);
  });

  it('commande retrouvée par son ticket de caisse ; trace « caisse » une seule fois', async () => {
    const id = randomUUID();
    await ordering.createOrder({
      id,
      tenantId: BELLA,
      restaurantId: bella,
      customer: {
        name: 'Test',
        email: `wh-${run}@example.fr`,
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
      idempotencyKey: `wh-${run}-1`,
      applicationFeeCents: 0,
      accessTokenHash: 'empreinte',
      maxOrdersPerSlot: null,
    });
    const ticket = randomUUID();
    await tickets.openTicket(BELLA, id, ticket, new Date());
    expect(await operations.findByPosTicket(BELLA, bella, ticket.toUpperCase())).toMatchObject({
      orderId: id,
      status: 'pending_payment',
      paymentMethod: 'online',
    });
    expect(await operations.findByPosTicket(BELLA, green, ticket)).toBeNull();
    expect(await operations.findByPosTicket(GREEN, bella, ticket)).toBeNull();
    const detail = {
      reason: 'Client parti',
      occurredAt: new Date().toISOString(),
      amountCents: 350,
    };
    expect(await operations.recordPosEvent(BELLA, id, 'pos_cancelled', detail)).toBe(true);
    expect(await operations.recordPosEvent(BELLA, id, 'pos_cancelled', detail)).toBe(false);
    const order = await reader.getOrderDetail(BELLA, id);
    expect(order?.events.filter((e) => e.status === 'pos_cancelled')).toEqual([
      expect.objectContaining({ actor: 'caisse', note: 'Client parti' }),
    ]);
  });
});
