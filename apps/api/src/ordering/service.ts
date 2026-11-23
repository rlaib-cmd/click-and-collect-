import type { MenuCache } from '@splash360/api-menu';
import type { AddressDto, OrderIssue, QuoteRequest } from '@splash360/contracts';
import type { LoyaltyTenant } from '@splash360/api-loyalty';
import {
  applyPromo,
  applyReward,
  normalizePromoCode,
  asapAvailability,
  availablePoints,
  reservedRewardPoints,
  pointsForAmount,
  bookableDates,
  checkRequestedTime,
  computeTotals,
  findDeliveryZone,
  fromLocal,
  priceCart,
  slotsForDate,
  type DeliveryZone,
  type PricedLine,
  type ScheduleSettings,
  type Slot,
  type Totals,
} from '@splash360/core';
import type { OrderingConfig, OrderingStore, Restaurant } from '@splash360/db';
import { verifyMemberToken, type LoyaltyDeps } from '../loyalty/service';

export interface OrderingDeps extends LoyaltyDeps {
  readonly ordering: OrderingStore;
  /** Produits et catégories masqués au back-office : absents de la commande en ligne. */
  readonly hiddenItems?: (
    tenantId: string,
    restaurantId: string,
  ) => Promise<{ products: Set<string>; categories: Set<string> }>;
  readonly menus: MenuCache;
  readonly now: () => Date;
}

/** Délai effectif : la livraison ajoute son temps de trajet à la préparation. */
function scheduleFor(config: OrderingConfig, mode: 'pickup' | 'delivery'): ScheduleSettings {
  return mode === 'delivery'
    ? { ...config.schedule, prepMinutes: config.schedule.prepMinutes + config.deliveryMinutes }
    : config.schedule;
}

function dayBounds(schedule: ScheduleSettings, date: string): [Date, Date] {
  return [fromLocal(date, 0, schedule.timezone), fromLocal(date, 24 * 60 - 1, schedule.timezone)];
}

/** Le restaurant peut encaisser en ligne : Stripe configuré et compte du restaurant autorisé. */
export function onlinePaymentAvailable(
  restaurant: Restaurant,
  gatewayConfigured: boolean,
): boolean {
  return (
    gatewayConfigured && restaurant.stripeAccountId !== null && restaurant.stripeChargesEnabled
  );
}

export function availability(
  restaurant: Restaurant,
  config: OrderingConfig,
  now: Date,
  gatewayConfigured = true,
) {
  const s = config.schedule;
  return {
    modes: { pickup: config.pickupEnabled, delivery: config.deliveryEnabled },
    paused: restaurant.status === 'paused',
    asap: asapAvailability(s, now),
    dates: bookableDates(s, now),
    timezone: s.timezone,
    delivery: config.deliveryEnabled
      ? {
          minimumCents: config.fees.deliveryMinimumCents,
          freeThresholdCents: config.fees.freeDeliveryThresholdCents,
        }
      : null,
    serviceFeeCents: config.fees.serviceFeeCents,
    payment: {
      online: onlinePaymentAvailable(restaurant, gatewayConfigured),
      onSite: config.payOnSiteEnabled === true,
    },
  };
}

export async function slotsFor(
  deps: OrderingDeps,
  restaurant: Restaurant,
  config: OrderingConfig,
  mode: 'pickup' | 'delivery',
  date: string,
): Promise<Slot[]> {
  const schedule = scheduleFor(config, mode);
  const [from, to] = dayBounds(schedule, date);
  const load = await deps.ordering.slotLoad(restaurant.id, from, to);
  return slotsForDate(schedule, date, deps.now(), load);
}

export function deliveryZoneFor(
  restaurant: Restaurant,
  config: OrderingConfig,
  address: AddressDto,
): DeliveryZone | null {
  const location =
    address.latitude !== null && address.longitude !== null
      ? { latitude: address.latitude, longitude: address.longitude }
      : null;
  const origin =
    restaurant.latitude !== null && restaurant.longitude !== null
      ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
      : null;
  return findDeliveryZone({ postalCode: address.postalCode, location }, origin, config.zones);
}

export type QuoteResult =
  | {
      readonly ok: true;
      readonly lines: readonly PricedLine[];
      readonly totals: Totals;
      readonly at: string;
      readonly slot: string | null;
      readonly zoneId: string | null;
      /** Membre du club : points à gagner et récompense appliquée. */
      readonly loyalty: {
        readonly memberId: string;
        readonly pointsEarned: number;
        readonly reward: {
          readonly id: string;
          readonly costPoints: number;
          /** Produit offert, choisi dans le palier (lot 11). */
          readonly productId: string;
        } | null;
      } | null;
      /** Code promo appliqué (lot 11, ADR 0015). */
      readonly promo: { readonly id: string; readonly code: string } | null;
    }
  | { readonly ok: false; readonly issues: readonly OrderIssue[] };

/**
 * Recontrôle complet côté serveur (section 4, « Avant paiement ») :
 * disponibilité, options, prix, créneau, zone, minimum. Tous les problèmes sont renvoyés d'un coup.
 */
export async function quote(
  deps: OrderingDeps,
  restaurant: Restaurant,
  config: OrderingConfig,
  request: QuoteRequest,
  tenant?: LoyaltyTenant,
  /** Commande en cours de création : sa propre réservation de points ne compte pas (rejeu). */
  idempotencyKey: string | null = null,
): Promise<QuoteResult> {
  const issues: OrderIssue[] = [];

  if (restaurant.status !== 'active') issues.push({ code: 'restaurant_paused' });
  const modeEnabled = request.mode === 'pickup' ? config.pickupEnabled : config.deliveryEnabled;
  if (!modeEnabled) issues.push({ code: 'mode_unavailable' });

  const { menu: full } = await deps.menus.get({
    restaurantId: restaurant.id,
    splash360RestaurantId: restaurant.splash360Id,
  });
  // Produits et catégories masqués au back-office : non commandables.
  const hidden = await deps.hiddenItems?.(restaurant.tenantId, restaurant.id);
  const menu = hidden
    ? {
        ...full,
        products: full.products.filter(
          (p) => !hidden.products.has(p.id) && !hidden.categories.has(p.categoryId),
        ),
      }
    : full;
  const priced = priceCart(
    menu,
    request.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      optionIds: l.optionIds,
      note: l.note ?? undefined,
    })),
  );
  if (!priced.ok) {
    for (const e of priced.errors) {
      issues.push({
        code: e.code,
        ...(e.line !== undefined ? { line: e.line } : {}),
        ...(e.productId !== undefined ? { productId: e.productId } : {}),
        ...(e.groupId !== undefined ? { groupId: e.groupId } : {}),
        ...(e.optionId !== undefined ? { optionId: e.optionId } : {}),
      });
    }
  }

  let zone: DeliveryZone | null = null;
  if (request.mode === 'delivery' && modeEnabled) {
    if (!request.address) issues.push({ code: 'address_required' });
    else {
      zone = deliveryZoneFor(restaurant, config, request.address);
      if (!zone) issues.push({ code: 'out_of_delivery_zone' });
    }
  }

  let totals: Totals | null = null;
  if (priced.ok && (request.mode === 'pickup' || zone)) {
    const result = computeTotals({
      mode: request.mode,
      subtotalCents: priced.subtotalCents,
      settings: config.fees,
      zoneFeeCents: zone?.feeCents,
    });
    if (result.ok) totals = result.totals;
    else issues.push({ code: 'below_delivery_minimum', missingCents: result.missingCents });
  }

  const schedule = scheduleFor(config, request.mode);
  const now = deps.now();
  let load = {};
  if (request.requestedTime.kind === 'scheduled') {
    const at = new Date(request.requestedTime.at);
    if (!Number.isNaN(at.getTime())) load = await deps.ordering.slotLoad(restaurant.id, at, at);
  }
  const time = checkRequestedTime(schedule, request.requestedTime, now, load);
  if (!time.ok) issues.push({ code: time.error });

  // Fidélité : membre reconnu par son jeton, récompense recontrôlée (solde lu chez Splash360).
  let loyalty: Extract<QuoteResult, { ok: true }>['loyalty'] = null;
  let loyaltyProgram: { readonly pointsPerEuro: number } | null = null;
  if (request.loyalty && tenant && deps.loyalty) {
    const memberId = verifyMemberToken(deps.tokenSecret, tenant.id, request.loyalty.memberToken);
    const [program, member] = await Promise.all([
      deps.loyalty.getProgram(tenant),
      memberId ? deps.loyalty.getMember(tenant, memberId) : Promise.resolve(null),
    ]);
    if (!program || !member) {
      issues.push({ code: 'loyalty_session_invalid' });
    } else {
      loyaltyProgram = program;
      let reward: { id: string; costPoints: number; productId: string } | null = null;
      if (request.loyalty.rewardId) {
        const chosen = program.rewards.find((r) => r.id === request.loyalty?.rewardId);
        // Sans choix explicite (anciennes versions), le premier produit du palier présent au panier.
        const productId =
          request.loyalty.rewardProductId ??
          chosen?.productIds.find((id) => request.lines.some((l) => l.productId === id)) ??
          chosen?.productIds[0] ??
          '';
        if (!chosen) issues.push({ code: 'unknown_reward' });
        else if (totals && priced.ok) {
          // Les points d'un cadeau déjà choisi dans une commande en cours sont réservés (ADR 0013).
          const holds = await deps.ordering.rewardHolds(tenant.id, member.id, idempotencyKey);
          const applied = applyReward({
            totals,
            lines: priced.lines,
            reward: chosen,
            productId,
            balance: availablePoints(member.points, reservedRewardPoints(holds, now)),
          });
          if (applied.ok) {
            totals = applied.totals;
            reward = { id: chosen.id, costPoints: chosen.costPoints, productId };
          } else issues.push({ code: applied.error, productId });
        }
      }
      loyalty = {
        memberId: member.id,
        pointsEarned: totals ? pointsForAmount(totals.totalCents, program) : 0,
        reward,
      };
    }
  } else if (request.loyalty && !deps.loyalty) {
    issues.push({ code: 'loyalty_session_invalid' });
  }

  // Code promo (ADR 0015) : après la récompense ; les points se gagnent sur le montant payé.
  let promo: { id: string; code: string } | null = null;
  if (request.promoCode && tenant && totals) {
    const code = normalizePromoCode(request.promoCode);
    const found = code ? await deps.ordering.findPromo(tenant.id, code) : null;
    const alreadyUsed =
      found && loyalty ? await deps.ordering.promoUsedByMember(found.id, loyalty.memberId) : false;
    const applied = applyPromo({
      totals,
      promo: found,
      now,
      uses: found?.uses ?? 0,
      alreadyUsed,
    });
    if (applied.ok && found) {
      totals = applied.totals;
      promo = { id: found.id, code: found.code };
      if (loyalty && loyaltyProgram) {
        loyalty = { ...loyalty, pointsEarned: pointsForAmount(totals.totalCents, loyaltyProgram) };
      }
    } else if (!applied.ok) issues.push({ code: applied.error });
  }

  if (issues.length > 0 || !priced.ok || !totals || !time.ok) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    lines: priced.lines,
    totals,
    at: time.at,
    slot: time.slot,
    zoneId: zone?.id ?? null,
    loyalty,
    promo,
  };
}
