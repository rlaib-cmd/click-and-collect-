import {
  cents,
  customerContactKey,
  type DeliveryZone,
  type FeeSettings,
  type OrderMode,
  type OrderStatus,
  type PricedLine,
  type PromoCode,
  type RewardHold,
  type ScheduleSettings,
  type SlotLoad,
  type SlotStep,
  type Totals,
} from '@splash360/core';
import type { Queryable, Sql } from './client';

/** Réglages de commande d'un restaurant, convertis dans les types de `@splash360/core`. */
export interface OrderingConfig {
  readonly pickupEnabled: boolean;
  /** Paiement sur place accepté (membres du club seulement, ADR 0010). */
  readonly payOnSiteEnabled?: boolean;
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
  /** Identifiant généré par le serveur (sert à dériver le jeton de suivi). */
  readonly id: string;
  readonly tenantId: string;
  readonly restaurantId: string;
  readonly customer: {
    readonly name: string;
    /** Facultatif (ADR 0013) : sans e-mail, le client est reconnu par son téléphone. */
    readonly email: string | null;
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
  /** Commission Splash360 calculée sur le total. */
  readonly applicationFeeCents: number;
  /** Empreinte SHA-256 du jeton de suivi remis au client. */
  readonly accessTokenHash: string;
  /** Capacité du créneau, revérifiée sous verrou ; null = illimitée. */
  readonly maxOrdersPerSlot: number | null;
  /** Membre du programme de fidélité et récompense utilisée (lot 8). */
  readonly loyalty?: OrderLoyalty | null;
  /** Sur place : commande confirmée tout de suite et envoyée en caisse (ADR 0010). */
  readonly paymentMethod?: 'online' | 'on_site';
  /** Code promo appliqué (lot 11) ; l'utilisation est enregistrée avec la commande. */
  readonly promo?: { readonly id: string; readonly code: string } | null;
}

/** Code promo tel que lu pour un devis (ADR 0015). */
export interface PromoRecord extends PromoCode {
  readonly id: string;
  /** Utilisations enregistrées. */
  readonly uses: number;
}

export interface OrderLoyalty {
  readonly memberId: string;
  readonly reward: {
    readonly id: string;
    readonly costPoints: number;
    /** Produit offert, choisi dans le palier (lot 11). */
    readonly productId: string;
  } | null;
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
  | { readonly ok: false; readonly error: 'slot_full' | 'promo_exhausted' | 'promo_already_used' };

export interface OrderingStore {
  getConfig(tenantId: string, restaurantId: string): Promise<OrderingConfig | null>;
  /** Commandes actives par créneau, sur une période. */
  slotLoad(restaurantId: string, from: Date, to: Date): Promise<SlotLoad>;
  createOrder(order: NewOrder): Promise<CreateOrderResult>;
  /**
   * Commandes d'un membre dont la récompense n'est pas encore réglée chez Splash360 (ADR 0013),
   * sauf celle de cette clé d'idempotence (une nouvelle tentative de la même commande).
   */
  rewardHolds(
    tenantId: string,
    memberId: string,
    exceptIdempotencyKey: string | null,
  ): Promise<RewardHold[]>;
  /** Code promo actif ou non d'une enseigne (code déjà normalisé). */
  findPromo(tenantId: string, code: string): Promise<PromoRecord | null>;
  /** Ce membre du club a-t-il déjà utilisé ce code ? */
  promoUsedByMember(promoId: string, memberId: string): Promise<boolean>;
  /** Historique des commandes d'un membre (lot 11), les plus récentes d'abord. */
  memberOrders(
    tenantId: string,
    memberId: string,
    page: { readonly limit: number; readonly beforeNumber: number | null },
  ): Promise<MemberOrderSummary[]>;
}

/** Commande vue dans « Mes commandes ». */
export interface MemberOrderSummary {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly mode: 'pickup' | 'delivery';
  readonly paymentMethod: 'online' | 'on_site';
  readonly totalCents: number;
  readonly createdAt: string;
  readonly restaurantId: string;
  readonly restaurantName: string;
  readonly items: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly productId: string;
    readonly optionIds: readonly string[];
    readonly note: string | null;
  }[];
}

/** Statuts qui occupent un créneau (une commande en attente de paiement le réserve). */
export const SLOT_HOLDING_STATUSES = [
  'pending_payment',
  'paid',
  'confirmed',
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
    async rewardHolds(tenantId, memberId, exceptIdempotencyKey) {
      const rows = await sql<{ status: OrderStatus; points: number; created_at: Date }[]>`
        select status, loyalty_reward_points as points, created_at from public.orders
        where tenant_id = ${tenantId} and loyalty_member_id = ${memberId}
          and loyalty_reward_id is not null and loyalty_settled_at is null
          and loyalty_reward_points is not null
          and idempotency_key is distinct from ${exceptIdempotencyKey}`;
      return rows.map((r) => ({ status: r.status, points: r.points, createdAt: r.created_at }));
    },

    async findPromo(tenantId, code) {
      const [p] = await sql<
        {
          id: string;
          code: string;
          kind: 'percent' | 'fixed';
          value: number;
          min_subtotal_cents: number;
          starts_at: Date | null;
          ends_at: Date | null;
          max_uses: number | null;
          active: boolean;
          uses: number;
        }[]
      >`
        select p.id, p.code, p.kind, p.value, p.min_subtotal_cents, p.starts_at, p.ends_at, p.max_uses, p.active,
               (select count(*)::int from public.promo_redemptions r where r.promo_code_id = p.id) as uses
        from public.promo_codes p where p.tenant_id = ${tenantId} and p.code = ${code}`;
      return p
        ? {
            id: p.id,
            code: p.code,
            kind: p.kind,
            value: p.value,
            minSubtotalCents: p.min_subtotal_cents,
            startsAt: p.starts_at,
            endsAt: p.ends_at,
            maxUses: p.max_uses,
            active: p.active,
            uses: p.uses,
          }
        : null;
    },

    async promoUsedByMember(promoId, memberId) {
      const [r] = await sql<{ used: boolean }[]>`
        select exists (select 1 from public.promo_redemptions
                       where promo_code_id = ${promoId} and loyalty_member_id = ${memberId}) as used`;
      return r?.used ?? false;
    },

    async memberOrders(tenantId, memberId, page) {
      const rows = await sql<
        {
          id: string;
          number: number;
          status: OrderStatus;
          mode: 'pickup' | 'delivery';
          payment_method: 'online' | 'on_site';
          total_cents: number;
          created_at: Date;
          restaurant_id: string;
          restaurant_name: string;
          items: {
            name: string;
            quantity: number;
            productId: string;
            optionIds: string[];
            note: string | null;
          }[];
        }[]
      >`
        select o.id, o.number, o.status, o.mode, o.payment_method, o.total_cents, o.created_at,
               o.restaurant_id, r.name as restaurant_name,
               coalesce(
                 (select json_agg(json_build_object(
                    'name', oi.name, 'quantity', oi.quantity, 'productId', oi.splash360_product_id,
                    'note', oi.note,
                    'optionIds', coalesce((select json_agg(oio.splash360_option_id)
                                           from public.order_item_options oio
                                           where oio.order_item_id = oi.id), '[]'::json))
                    order by oi.position)
                  from public.order_items oi where oi.order_id = o.id),
                 '[]'::json) as items
        from public.orders o
        join public.restaurants r on r.id = o.restaurant_id
        where o.tenant_id = ${tenantId} and o.loyalty_member_id = ${memberId}
          and (${page.beforeNumber}::int is null or o.number < ${page.beforeNumber})
        order by o.number desc
        limit ${page.limit}`;
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        mode: r.mode,
        paymentMethod: r.payment_method,
        totalCents: r.total_cents,
        createdAt: r.created_at.toISOString(),
        restaurantId: r.restaurant_id,
        restaurantName: r.restaurant_name,
        items: r.items,
      }));
    },

    async getConfig(tenantId, restaurantId) {
      const [s] = await sql<
        {
          pickup_enabled: boolean;
          delivery_enabled: boolean;
          pay_on_site_enabled: boolean;
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
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId} and not archived`,
      ]);
      return {
        pickupEnabled: s.pickup_enabled,
        payOnSiteEnabled: s.pay_on_site_enabled,
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
      const onSite = o.paymentMethod === 'on_site';
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

        const email = o.customer.email?.trim().toLowerCase() || null;
        const contactKey = customerContactKey({ email, phone: o.customer.phone });
        if (!contactKey) throw new Error('Client sans e-mail ni téléphone');
        const [customer] = await tx<{ id: string }[]>`
          insert into public.customers (tenant_id, name, email, phone, marketing_consent, contact_key)
          values (${o.tenantId}, ${o.customer.name}, ${email}, ${o.customer.phone}, ${o.customer.marketingConsent}, ${contactKey})
          on conflict (tenant_id, contact_key) do update
            set name = excluded.name, phone = excluded.phone,
                email = coalesce(excluded.email, public.customers.email),
                marketing_consent = public.customers.marketing_consent or excluded.marketing_consent
          returning id`;

        // Code promo (ADR 0015) : sous verrou du code, plafond d'utilisations et une fois par client.
        if (o.promo) {
          const [promo] = await tx<{ max_uses: number | null; uses: number; used: boolean }[]>`
            select p.max_uses,
                   (select count(*)::int from public.promo_redemptions r where r.promo_code_id = p.id) as uses,
                   exists (select 1 from public.promo_redemptions r
                           where r.promo_code_id = p.id
                             and (r.contact_key = ${contactKey}
                                  or (${o.loyalty?.memberId ?? null}::text is not null
                                      and r.loyalty_member_id = ${o.loyalty?.memberId ?? null}))) as used
            from public.promo_codes p
            where p.id = ${o.promo.id} and p.tenant_id = ${o.tenantId}
            for update`;
          if (!promo || (promo.max_uses !== null && promo.uses >= promo.max_uses))
            return { ok: false as const, error: 'promo_exhausted' as const };
          if (promo.used) return { ok: false as const, error: 'promo_already_used' as const };
        }

        const [counter] = await tx<{ n: number }[]>`
          insert into public.tenant_counters (tenant_id, last_order_number) values (${o.tenantId}, 1001)
          on conflict (tenant_id) do update set last_order_number = public.tenant_counters.last_order_number + 1
          returning last_order_number as n`;

        const [order] = await tx<
          { id: string; number: number; status: string; total_cents: number; created_at: Date }[]
        >`
          insert into public.orders (id, tenant_id, restaurant_id, customer_id, number, mode, requested_slot, estimated_at,
            delivery_address, delivery_zone_id, subtotal_cents, delivery_fee_cents, service_fee_cents, discount_cents,
            total_cents, idempotency_key, application_fee_cents, access_token_hash,
            loyalty_member_id, loyalty_reward_id, loyalty_reward_points, loyalty_reward_product_id,
            promo_code, promo_discount_cents, payment_method, status)
          values (${o.id}, ${o.tenantId}, ${o.restaurantId}, ${customer?.id ?? null}, ${counter?.n ?? 0}, ${o.mode},
            ${o.requestedSlot}, ${o.estimatedAt},
            ${o.deliveryAddress ? tx.json(o.deliveryAddress as unknown as Parameters<typeof tx.json>[0]) : null},
            ${o.deliveryZoneId}, ${o.totals.subtotalCents}, ${o.totals.deliveryFeeCents}, ${o.totals.serviceFeeCents},
            ${o.totals.discountCents}, ${o.totals.totalCents}, ${o.idempotencyKey}, ${o.applicationFeeCents},
            ${o.accessTokenHash}, ${o.loyalty?.memberId ?? null}, ${o.loyalty?.reward?.id ?? null},
            ${o.loyalty?.reward?.costPoints ?? null}, ${o.loyalty?.reward?.productId ?? null},
            ${o.promo?.code ?? null}, ${o.totals.promoDiscountCents},
            ${onSite ? 'on_site' : 'online'},
            ${onSite ? 'confirmed' : 'pending_payment'})
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

        if (o.promo) {
          await tx`
            insert into public.promo_redemptions (tenant_id, promo_code_id, order_id, contact_key, loyalty_member_id)
            values (${o.tenantId}, ${o.promo.id}, ${order.id}, ${contactKey}, ${o.loyalty?.memberId ?? null})`;
        }

        await tx`
          insert into public.order_events (tenant_id, order_id, status, actor)
          values (${o.tenantId}, ${order.id}, ${onSite ? 'confirmed' : 'pending_payment'}, 'customer')`;
        // Sur place : rien à attendre de Stripe, la commande part en caisse (même transaction).
        if (onSite) {
          await tx`insert into public.pos_dispatches (order_id, tenant_id) values (${order.id}, ${o.tenantId})
                   on conflict (order_id) do nothing`;
        }

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

export interface OrderDetail {
  readonly id: string;
  readonly tenantId: string;
  readonly restaurantId: string;
  readonly number: number;
  readonly status: string;
  readonly mode: OrderMode;
  readonly requestedSlot: string | null;
  readonly estimatedAt: string;
  readonly createdAt: string;
  readonly totals: Totals;
  readonly refundedCents: number;
  readonly customer: {
    readonly name: string;
    readonly email: string | null;
    readonly phone: string;
  };
  readonly deliveryAddress: DeliveryAddressRecord | null;
  readonly lines: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly unitPriceCents: number;
    readonly totalCents: number;
    readonly note: string | null;
    readonly options: readonly { readonly name: string; readonly priceCents: number }[];
  }[];
  readonly events: readonly {
    readonly status: string;
    readonly actor: string;
    readonly at: string;
  }[];
  readonly accessTokenHash: string | null;
  readonly paymentMethod: 'online' | 'on_site';
  readonly loyalty: {
    readonly memberId: string;
    readonly rewardId: string | null;
    readonly rewardPoints: number | null;
    readonly settled: boolean;
  } | null;
}

export interface OrderReader {
  getOrderDetail(tenantId: string, orderId: string): Promise<OrderDetail | null>;
}

const ORDER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresOrderReader(sql: Sql): OrderReader {
  return {
    async getOrderDetail(tenantId, orderId) {
      if (!ORDER_UUID.test(orderId)) return null;
      const [o] = await sql<
        {
          id: string;
          tenant_id: string;
          restaurant_id: string;
          number: number;
          status: string;
          mode: OrderMode;
          requested_slot: Date | null;
          estimated_at: Date;
          created_at: Date;
          subtotal_cents: number;
          delivery_fee_cents: number;
          service_fee_cents: number;
          discount_cents: number;
          promo_discount_cents: number;
          total_cents: number;
          refunded_cents: number;
          loyalty_member_id: string | null;
          loyalty_reward_id: string | null;
          loyalty_reward_points: number | null;
          loyalty_settled_at: Date | null;
          payment_method: 'online' | 'on_site';
          delivery_address: DeliveryAddressRecord | null;
          access_token_hash: string | null;
          customer_name: string;
          customer_email: string | null;
          customer_phone: string;
        }[]
      >`
        select o.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
        from public.orders o join public.customers c on c.id = o.customer_id
        where o.tenant_id = ${tenantId} and o.id = ${orderId}`;
      if (!o) return null;
      const [items, options, events] = await Promise.all([
        sql<
          {
            id: string;
            name: string;
            quantity: number;
            unit_price_cents: number;
            total_cents: number;
            note: string | null;
          }[]
        >`
          select id, name, quantity, unit_price_cents, total_cents, note from public.order_items
          where tenant_id = ${tenantId} and order_id = ${orderId} order by position`,
        sql<{ order_item_id: string; name: string; price_cents: number }[]>`
          select oio.order_item_id, oio.name, oio.price_cents from public.order_item_options oio
          join public.order_items oi on oi.id = oio.order_item_id
          where oi.tenant_id = ${tenantId} and oi.order_id = ${orderId} order by oio.id`,
        sql<{ status: string; actor: string; created_at: Date }[]>`
          select status, actor, created_at from public.order_events
          where tenant_id = ${tenantId} and order_id = ${orderId} order by created_at, id`,
      ]);
      return {
        id: o.id,
        tenantId: o.tenant_id,
        restaurantId: o.restaurant_id,
        number: o.number,
        status: o.status,
        mode: o.mode,
        requestedSlot: o.requested_slot?.toISOString() ?? null,
        estimatedAt: o.estimated_at.toISOString(),
        createdAt: o.created_at.toISOString(),
        totals: {
          subtotalCents: cents(o.subtotal_cents),
          deliveryFeeCents: cents(o.delivery_fee_cents),
          serviceFeeCents: cents(o.service_fee_cents),
          discountCents: cents(o.discount_cents),
          promoDiscountCents: cents(o.promo_discount_cents),
          totalCents: cents(o.total_cents),
        },
        refundedCents: o.refunded_cents,
        paymentMethod: o.payment_method,
        loyalty: o.loyalty_member_id
          ? {
              memberId: o.loyalty_member_id,
              rewardId: o.loyalty_reward_id,
              rewardPoints: o.loyalty_reward_points,
              settled: o.loyalty_settled_at !== null,
            }
          : null,
        customer: { name: o.customer_name, email: o.customer_email, phone: o.customer_phone },
        deliveryAddress: o.delivery_address,
        lines: items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          totalCents: i.total_cents,
          note: i.note,
          options: options
            .filter((x) => x.order_item_id === i.id)
            .map((x) => ({ name: x.name, priceCents: x.price_cents })),
        })),
        events: events.map((e) => ({
          status: e.status,
          actor: e.actor,
          at: e.created_at.toISOString(),
        })),
        accessTokenHash: o.access_token_hash,
      };
    },
  };
}
