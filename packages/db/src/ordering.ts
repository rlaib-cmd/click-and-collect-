import {
  cents,
  type DeliveryZone,
  type FeeSettings,
  type OrderMode,
  type PricedLine,
  type ScheduleSettings,
  type SlotLoad,
  type SlotStep,
  type Totals,
} from '@splash360/core';
import type { Queryable, Sql } from './client';

/** Réglages de commande d'un restaurant, convertis dans les types de `@splash360/core`. */
export interface OrderingConfig {
  readonly pickupEnabled: boolean;
  readonly deliveryEnabled: boolean;
  /** Délai supplémentaire de livraison, ajouté à la préparation. */
  readonly deliveryMinutes: number;
  readonly schedule: ScheduleSettings;
  readonly fees: FeeSettings;
  readonly zones: readonly DeliveryZone[];
}

export interface DeliveryAddressRecord {
  readonly label: string;
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly instructions: string | null;
}

export interface NewOrder {
  readonly tenantId: string;
  readonly restaurantId: string;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly marketingConsent: boolean;
  };
  readonly mode: OrderMode;
  /** null = dès que possible ; sinon instant ISO du créneau réservé. */
  readonly requestedSlot: string | null;
  readonly estimatedAt: string;
  readonly deliveryAddress: DeliveryAddressRecord | null;
  readonly deliveryZoneId: string | null;
  readonly lines: readonly PricedLine[];
  readonly totals: Totals;
  readonly idempotencyKey: string;
  /** Capacité du créneau, revérifiée sous verrou ; null = illimitée. */
  readonly maxOrdersPerSlot: number | null;
}

export interface OrderSummary {
  readonly id: string;
  readonly number: number;
  readonly status: string;
  readonly totalCents: number;
  readonly createdAt: string;
}

export type CreateOrderResult =
  | { readonly ok: true; readonly order: OrderSummary; readonly replayed: boolean }
  | { readonly ok: false; readonly error: 'slot_full' };

export interface OrderingStore {
  getConfig(tenantId: string, restaurantId: string): Promise<OrderingConfig | null>;
  /** Commandes actives par créneau, sur une période. */
  slotLoad(restaurantId: string, from: Date, to: Date): Promise<SlotLoad>;
  createOrder(order: NewOrder): Promise<CreateOrderResult>;
}

/** Statuts qui occupent un créneau (une commande en attente de paiement le réserve). */
export const SLOT_HOLDING_STATUSES = [
  'pending_payment',
  'paid',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
] as const;

const hhmm = (t: string) => t.slice(0, 5);

export function createPostgresOrderingStore(sql: Sql): OrderingStore {
  async function load(
    tx: Queryable,
    restaurantId: string,
    from: Date,
    to: Date,
  ): Promise<SlotLoad> {
    const rows = await tx<{ slot: Date; n: number }[]>`
      select requested_slot as slot, count(*)::int as n
      from public.orders
      where restaurant_id = ${restaurantId}
        and requested_slot >= ${from} and requested_slot <= ${to}
        and status in ${sql(SLOT_HOLDING_STATUSES)}
      group by requested_slot`;
    return Object.fromEntries(rows.map((r) => [r.slot.toISOString(), r.n]));
  }

  return {
    async getConfig(tenantId, restaurantId) {
      const [s] = await sql<
        {
          pickup_enabled: boolean;
          delivery_enabled: boolean;
          prep_minutes: number;
          delivery_minutes: number;
          slot_step_minutes: SlotStep;
          max_orders_per_slot: number | null;
          days_ahead: number;
          delivery_minimum_cents: number;
          free_delivery_threshold_cents: number | null;
          service_fee_cents: number;
          timezone: string;
        }[]
      >`select * from public.restaurant_settings
        where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`;
      if (!s) return null;
      const [hours, closures, zones] = await Promise.all([
        sql<{ iso_weekday: number; opens: string; closes: string }[]>`
          select iso_weekday, opens::text, closes::text from public.opening_hours
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`,
        sql<{ day: string }[]>`
          select day::text from public.closures
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId} and day >= current_date - 1`,
        sql<
          {
            id: string;
            kind: 'radius' | 'postal_codes';
            radius_meters: number | null;
            postal_codes: string[];
            fee_cents: number;
          }[]
        >`
          select id, kind, radius_meters, postal_codes, fee_cents from public.delivery_zones
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`,
      ]);
      return {
        pickupEnabled: s.pickup_enabled,
        deliveryEnabled: s.delivery_enabled,
        deliveryMinutes: s.delivery_minutes,
        schedule: {
          timezone: s.timezone,
          openingHours: hours.map((h) => ({
            isoWeekday: h.iso_weekday,
            opens: hhmm(h.opens),
            closes: hhmm(h.closes),
          })),
          closures: closures.map((c) => c.day),
          slotStepMinutes: s.slot_step_minutes,
          prepMinutes: s.prep_minutes,
          maxOrdersPerSlot: s.max_orders_per_slot,
          daysAhead: s.days_ahead,
        },
        fees: {
          deliveryMinimumCents: cents(s.delivery_minimum_cents),
          freeDeliveryThresholdCents:
            s.free_delivery_threshold_cents === null
              ? null
              : cents(s.free_delivery_threshold_cents),
          serviceFeeCents: cents(s.service_fee_cents),
        },
        zones: zones.map((z): DeliveryZone =>
          z.kind === 'radius'
            ? {
                id: z.id,
                kind: 'radius',
                radiusMeters: z.radius_meters ?? 0,
                feeCents: cents(z.fee_cents),
              }
            : {
                id: z.id,
                kind: 'postal_codes',
                postalCodes: z.postal_codes,
                feeCents: cents(z.fee_cents),
              },
        ),
      };
    },

    slotLoad: (restaurantId, from, to) => load(sql, restaurantId, from, to),

    async createOrder(o) {
      return sql.begin(async (tx) => {
        // Rejeu idempotent : même clé → même commande (double clic, réseau instable).
        const [existing] = await tx<
          { id: string; number: number; status: string; total_cents: number; created_at: Date }[]
        >`
          select id, number, status, total_cents, created_at from public.orders
          where tenant_id = ${o.tenantId} and idempotency_key = ${o.idempotencyKey}`;
        if (existing) {
          return {
            ok: true as const,
            replayed: true,
            order: {
              id: existing.id,
              number: existing.number,
              status: existing.status,
              totalCents: existing.total_cents,
              createdAt: existing.created_at.toISOString(),
            },
          };
        }

        // Verrou par restaurant : deux commandes ne peuvent pas prendre la dernière place d'un créneau.
        await tx`select id from public.restaurants where id = ${o.restaurantId} and tenant_id = ${o.tenantId} for update`;
        if (o.requestedSlot && o.maxOrdersPerSlot !== null) {
          const at = new Date(o.requestedSlot);
          const taken = (await load(tx, o.restaurantId, at, at))[at.toISOString()] ?? 0;
          if (taken >= o.maxOrdersPerSlot)
            return { ok: false as const, error: 'slot_full' as const };
        }

        const [customer] = await tx<{ id: string }[]>`
          insert into public.customers (tenant_id, name, email, phone, marketing_consent)
          values (${o.tenantId}, ${o.customer.name}, ${o.customer.email.toLowerCase()}, ${o.customer.phone}, ${o.customer.marketingConsent})
          on conflict (tenant_id, email) do update
            set name = excluded.name, phone = excluded.phone,
                marketing_consent = public.customers.marketing_consent or excluded.marketing_consent
          returning id`;

        const [counter] = await tx<{ n: number }[]>`
          insert into public.tenant_counters (tenant_id, last_order_number) values (${o.tenantId}, 1001)
          on conflict (tenant_id) do update set last_order_number = public.tenant_counters.last_order_number + 1
          returning last_order_number as n`;

        const [order] = await tx<
          { id: string; number: number; status: string; total_cents: number; created_at: Date }[]
        >`
          insert into public.orders (tenant_id, restaurant_id, customer_id, number, mode, requested_slot, estimated_at,
            delivery_address, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents,
            idempotency_key)
          values (${o.tenantId}, ${o.restaurantId}, ${customer?.id ?? null}, ${counter?.n ?? 0}, ${o.mode},
            ${o.requestedSlot}, ${o.estimatedAt},
            ${o.deliveryAddress ? tx.json(o.deliveryAddress as unknown as Parameters<typeof tx.json>[0]) : null},
            ${o.deliveryZoneId}, ${o.totals.subtotalCents}, ${o.totals.deliveryFeeCents}, ${o.totals.serviceFeeCents},
            ${o.totals.totalCents}, ${o.idempotencyKey})
          returning id, number, status, total_cents, created_at`;
        if (!order) throw new Error('Insertion de commande sans retour');

        for (const [position, line] of o.lines.entries()) {
          const [item] = await tx<{ id: string }[]>`
            insert into public.order_items (tenant_id, order_id, position, splash360_product_id, name,
              unit_price_cents, quantity, total_cents, note)
            values (${o.tenantId}, ${order.id}, ${position}, ${line.productId}, ${line.name},
              ${line.unitPriceCents}, ${line.quantity}, ${line.totalCents}, ${line.note})
            returning id`;
          for (const opt of line.options) {
            await tx`
              insert into public.order_item_options (tenant_id, order_item_id, splash360_group_id,
                splash360_option_id, name, price_cents)
              values (${o.tenantId}, ${item?.id ?? null}, ${opt.groupId}, ${opt.optionId}, ${opt.name}, ${opt.priceCents})`;
          }
        }

        await tx`
          insert into public.order_events (tenant_id, order_id, status, actor)
          values (${o.tenantId}, ${order.id}, 'pending_payment', 'customer')`;

        return {
          ok: true as const,
          replayed: false,
          order: {
            id: order.id,
            number: order.number,
            status: order.status,
            totalCents: order.total_cents,
            createdAt: order.created_at.toISOString(),
          },
        };
      });
    },
  };
}
