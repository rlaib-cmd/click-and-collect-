import {
  addressSchema,
  orderModeSchema,
  placeOrderRequestSchema,
  quoteRequestSchema,
  type Availability,
  type DeliveryCheck,
  type PlacedOrder,
  type Quote,
  type SlotsDto,
} from '@splash360/contracts';
import type { Restaurant, RestaurantStore, TenantWithTheme } from '@splash360/db';
import type { Context, Hono } from 'hono';
import { cents, checkPaymentMethod, computeApplicationFee } from '@splash360/core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashToken, orderAccessToken } from '../payments/tokens';
import { apiError } from '../errors';
import type { PaymentGateway } from '../payments/gateway';
import type { GeoProvider } from '../geo';
import {
  availability,
  deliveryZoneFor,
  quote,
  slotsFor,
  type OrderingDeps,
} from '../ordering/service';

export interface OrderingRoutesDeps extends OrderingDeps {
  readonly restaurants: RestaurantStore;
  readonly geo: GeoProvider;
  /** Clé secrète de dérivation des jetons de suivi (ORDER_TOKEN_SECRET). */
  readonly tokenSecret: string;
  /** Paiement en ligne configuré (clés Stripe présentes) ; null sinon. */
  readonly gateway: PaymentGateway | null;
  /** Commande à payer sur place créée : notification et envoi en caisse (ADR 0010). */
  readonly onConfirmed?: (order: { orderId: string; tenantId: string }) => Promise<void>;
}

type Env = { Variables: { tenant: TenantWithTheme } };

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Routes de prise de commande (lot 3), montées sous /v1/tenants/:subdomain. */
export function registerOrderingRoutes(app: Hono<Env>, deps: OrderingRoutesDeps) {
  async function load(c: Context<Env>, restaurantId: string) {
    const tenant = c.get('tenant');
    const restaurant = await deps.restaurants.findById(tenant.id, restaurantId);
    if (!restaurant || restaurant.status === 'closed') return null;
    const config = await deps.ordering.getConfig(tenant.id, restaurant.id);
    if (!config) return null;
    return { restaurant, config };
  }

  app.get('/:subdomain/restaurants/:restaurantId/availability', async (c) => {
    const ctx = await load(c, c.req.param('restaurantId'));
    if (!ctx) return apiError(c, 'not_found', 'Restaurant inconnu');
    const body: Availability = availability(
      ctx.restaurant,
      ctx.config,
      deps.now(),
      deps.gateway !== null,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.get('/:subdomain/restaurants/:restaurantId/slots', async (c) => {
    const query = z
      .object({ mode: orderModeSchema, date: z.iso.date() })
      .safeParse({ mode: c.req.query('mode'), date: c.req.query('date') });
    if (!query.success) return apiError(c, 'invalid_request', 'Paramètres mode et date requis');
    const ctx = await load(c, c.req.param('restaurantId'));
    if (!ctx) return apiError(c, 'not_found', 'Restaurant inconnu');
    const slots = await slotsFor(
      deps,
      ctx.restaurant,
      ctx.config,
      query.data.mode,
      query.data.date,
    );
    const body: SlotsDto = { date: query.data.date, slots };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.post('/:subdomain/restaurants/:restaurantId/delivery-check', async (c) => {
    const address = await readJson(c, addressSchema);
    if (!address) return apiError(c, 'invalid_request', 'Adresse invalide');
    const ctx = await load(c, c.req.param('restaurantId'));
    if (!ctx) return apiError(c, 'not_found', 'Restaurant inconnu');
    const zone = ctx.config.deliveryEnabled
      ? deliveryZoneFor(ctx.restaurant, ctx.config, address)
      : null;
    const body: DeliveryCheck = zone
      ? { deliverable: true, feeCents: zone.feeCents, zoneId: zone.id }
      : { deliverable: false };
    return c.json(body);
  });

  app.post('/:subdomain/restaurants/:restaurantId/quote', async (c) => {
    const request = await readJson(c, quoteRequestSchema);
    if (!request) return apiError(c, 'invalid_request', 'Panier invalide');
    const ctx = await load(c, c.req.param('restaurantId'));
    if (!ctx) return apiError(c, 'not_found', 'Restaurant inconnu');
    const result = await quote(deps, ctx.restaurant, ctx.config, request, c.get('tenant'));
    if (!result.ok) return orderInvalid(c, result.issues);
    const body: Quote = {
      lines: result.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        options: l.options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          priceCents: o.priceCents,
        })),
        unitPriceCents: l.unitPriceCents,
        totalCents: l.totalCents,
        note: l.note,
      })),
      totals: result.totals,
      at: result.at,
      loyalty: result.loyalty
        ? {
            pointsEarned: result.loyalty.pointsEarned,
            rewardId: result.loyalty.reward?.id ?? null,
            rewardProductId: result.loyalty.reward?.productId ?? null,
          }
        : null,
      promoCode: result.promo?.code ?? null,
    };
    return c.json(body);
  });

  app.post('/:subdomain/orders', async (c) => {
    const request = await readJson(c, placeOrderRequestSchema);
    if (!request) return apiError(c, 'invalid_request', 'Commande invalide');
    const tenant = c.get('tenant');
    const ctx = await load(c, request.restaurantId);
    if (!ctx) return apiError(c, 'not_found', 'Restaurant inconnu');
    const result = await quote(
      deps,
      ctx.restaurant,
      ctx.config,
      request,
      c.get('tenant'),
      request.idempotencyKey,
    );
    if (!result.ok) return orderInvalid(c, result.issues);
    // Sur place : option du restaurant, réservée aux membres du club (ADR 0010). En ligne, la
    // capacité d'encaisser du restaurant est contrôlée à la création du paiement.
    if (request.paymentMethod === 'on_site') {
      const choice = checkPaymentMethod({
        method: 'on_site',
        onlineAvailable: false,
        onSiteEnabled: ctx.config.payOnSiteEnabled === true,
        isMember: result.loyalty !== null,
      });
      if (!choice.ok) return orderInvalid(c, [{ code: choice.error }]);
    }

    const orderId = randomUUID();
    const created = await deps.ordering.createOrder({
      id: orderId,
      tenantId: tenant.id,
      restaurantId: ctx.restaurant.id,
      customer: request.customer,
      mode: request.mode,
      requestedSlot: result.slot,
      estimatedAt: result.at,
      deliveryAddress:
        request.mode === 'delivery' && request.address
          ? { ...request.address, instructions: request.address.instructions ?? null }
          : null,
      deliveryZoneId: result.zoneId,
      lines: result.lines,
      totals: result.totals,
      idempotencyKey: request.idempotencyKey,
      applicationFeeCents: computeApplicationFee(result.totals.totalCents, {
        bps: tenant.applicationFee.bps,
        fixedCents: cents(tenant.applicationFee.fixedCents),
      }),
      accessTokenHash: hashToken(orderAccessToken(deps.tokenSecret, orderId)),
      maxOrdersPerSlot: ctx.config.schedule.maxOrdersPerSlot,
      loyalty: result.loyalty
        ? {
            memberId: result.loyalty.memberId,
            reward: result.loyalty.reward,
            balance: result.loyalty.balance,
          }
        : null,
      paymentMethod: request.paymentMethod,
      promo: result.promo,
    });
    if (!created.ok) {
      // Code promo épuisé ou déjà utilisé par ce client, constaté sous verrou (ADR 0015).
      if (created.error === 'idempotency_conflict')
        return apiError(c, 'invalid_request', 'Clé de commande déjà utilisée');
      if (created.error !== 'slot_full') return orderInvalid(c, [{ code: created.error }]);
      return apiError(c, 'slot_full', 'Ce créneau vient d’être complété');
    }

    const body: PlacedOrder = {
      orderId: created.order.id,
      number: created.order.number,
      status: created.order.status,
      totals: result.totals,
      at: result.at,
      // Rejeu idempotent : même commande, donc même jeton.
      accessToken: orderAccessToken(deps.tokenSecret, created.order.id),
      paymentMethod: request.paymentMethod,
    };
    if (request.paymentMethod === 'on_site' && !created.replayed) {
      await deps.onConfirmed?.({ orderId: created.order.id, tenantId: tenant.id });
    }
    return c.json(body, created.replayed ? 200 : 201);
  });

  app.get('/:subdomain/geo/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 3 || q.length > 200) return c.json({ results: [] });
    try {
      return c.json({ results: await deps.geo.search(q) });
    } catch {
      return c.json({ results: [] });
    }
  });
}

function orderInvalid(c: Context, issues: Parameters<typeof apiError>[3]) {
  return apiError(c, 'order_invalid', 'La commande doit être corrigée', issues);
}

export type { Restaurant };
