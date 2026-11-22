import type { MenuCache } from '@splash360/api-menu';
import type { AddressDto, OrderIssue, QuoteRequest } from '@splash360/contracts';
import {
  asapAvailability,
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

export interface OrderingDeps {
  readonly ordering: OrderingStore;
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

export function availability(restaurant: Restaurant, config: OrderingConfig, now: Date) {
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
): Promise<QuoteResult> {
  const issues: OrderIssue[] = [];

  if (restaurant.status !== 'active') issues.push({ code: 'restaurant_paused' });
  const modeEnabled = request.mode === 'pickup' ? config.pickupEnabled : config.deliveryEnabled;
  if (!modeEnabled) issues.push({ code: 'mode_unavailable' });

  const { menu } = await deps.menus.get({
    restaurantId: restaurant.id,
    splash360RestaurantId: restaurant.splash360Id,
  });
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
  };
}
