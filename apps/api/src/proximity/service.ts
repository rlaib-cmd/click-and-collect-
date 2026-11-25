import type { LoyaltyProvider, LoyaltyTenant } from '@splash360/api-loyalty';
import {
  decideProximityPush,
  PROXIMITY_EVENT_RETENTION_DAYS,
  renderProximityText,
  type ProximityReason,
} from '@splash360/core';
import type { ProximityPushData } from '@splash360/contracts';
import type { OrderingStore, ProximityStore, RestaurantStore } from '@splash360/db';
import type { NotificationSender } from '../notifications/sender';

/**
 * Notifications « Bons plans à proximité » (lot 22, ADR 0027). L'application signale seulement
 * l'entrée dans la zone d'un restaurant ; le serveur décide (règles de l'enseigne) et envoie.
 */
export interface ProximityDeps {
  readonly proximity: ProximityStore;
  readonly restaurants: RestaurantStore;
  readonly ordering: Pick<OrderingStore, 'getConfig'>;
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly notifier: NotificationSender;
  readonly now: () => Date;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

export type EnterOutcome =
  | { readonly status: 'unknown_restaurant' }
  | { readonly status: 'done'; readonly notified: boolean; readonly reason: ProximityReason };

const HOUR_MS = 3_600_000;
const DEFAULT_TIMEZONE = 'Europe/Paris';

/** Solde et cadeau le moins cher, lus seulement pour la cible « cadeau disponible ». */
async function rewardContext(
  loyalty: LoyaltyProvider | undefined,
  tenant: LoyaltyTenant,
  memberId: string,
): Promise<{ points: number | null; cheapest: number | null }> {
  if (!loyalty) return { points: null, cheapest: null };
  try {
    const [program, member] = await Promise.all([
      loyalty.getProgram(tenant),
      loyalty.getMember(tenant, memberId),
    ]);
    const costs = (program?.rewards ?? []).map((r) => r.costPoints).filter((c) => c > 0);
    return {
      points: member ? member.points : null,
      cheapest: costs.length ? Math.min(...costs) : null,
    };
  } catch {
    return { points: null, cheapest: null };
  }
}

export async function handleProximityEnter(
  deps: ProximityDeps,
  tenant: LoyaltyTenant,
  memberId: string,
  restaurantId: string,
): Promise<EnterOutcome> {
  const restaurant = await deps.restaurants.findById(tenant.id, restaurantId);
  if (!restaurant || restaurant.status === 'closed') return { status: 'unknown_restaurant' };
  const now = deps.now();
  const rules = await deps.proximity.getSettings(tenant.id);
  // Fonction coupée ou accord absent : rien n'est enregistré.
  if (!rules.enabled) return { status: 'done', notified: false, reason: 'disabled' };
  const tokens = await deps.proximity.memberTokens(tenant.id, memberId);
  if (tokens.length === 0) return { status: 'done', notified: false, reason: 'no_device' };

  const [config, last, lastOrderAt, reward] = await Promise.all([
    deps.ordering.getConfig(tenant.id, restaurant.id),
    deps.proximity.lastSent(tenant.id, memberId, restaurant.id),
    rules.target === 'inactive'
      ? deps.proximity.lastOrderAt(tenant.id, memberId)
      : Promise.resolve(null),
    rules.target === 'reward'
      ? rewardContext(deps.loyalty, tenant, memberId)
      : Promise.resolve({ points: null, cheapest: null }),
  ]);
  const decision = decideProximityPush(rules, {
    now,
    restaurant: {
      available:
        restaurant.status === 'active' &&
        restaurant.latitude !== null &&
        restaurant.longitude !== null,
      timezone: config?.schedule.timezone ?? DEFAULT_TIMEZONE,
      openingHours: config?.schedule.openingHours ?? [],
      closures: config?.schedule.closures ?? [],
    },
    hasDevice: true,
    lastSentToMember: last.member,
    lastSentForRestaurant: last.restaurant,
    points: reward.points,
    cheapestRewardCost: reward.cheapest,
    lastOrderAt,
  });
  const skip = async (reason: Exclude<ProximityReason, 'sent'>): Promise<EnterOutcome> => {
    await deps.proximity.recordSkipped({
      tenantId: tenant.id,
      memberId,
      restaurantId: restaurant.id,
      reason,
      at: now,
    });
    return { status: 'done', notified: false, reason };
  };
  if (decision.reason !== 'sent') return skip(decision.reason);

  const eventId = await deps.proximity.claimSend({
    tenantId: tenant.id,
    memberId,
    restaurantId: restaurant.id,
    at: now,
    memberSince: new Date(now.getTime() - rules.memberCapHours * HOUR_MS),
    restaurantSince: new Date(now.getTime() - rules.restaurantCapHours * HOUR_MS),
  });
  // Une autre entrée simultanée a déjà envoyé la notification.
  if (!eventId) return skip('member_cap');

  const data: ProximityPushData = { kind: 'proximity', eventId, link: rules.deepLink };
  try {
    await deps.notifier.push(tokens, {
      title: renderProximityText(rules.title, restaurant.name),
      body: renderProximityText(rules.body, restaurant.name),
      data,
    });
  } catch (error) {
    await deps.proximity.markFailed(tenant.id, eventId);
    deps.log?.('Notification à proximité non envoyée', { error: String(error) });
    return { status: 'done', notified: false, reason: 'sent' };
  }
  return { status: 'done', notified: true, reason: 'sent' };
}

/** Purge des événements de plus de 90 jours (tâche périodique de l'API). */
export async function purgeProximityEvents(store: ProximityStore, now: Date): Promise<number> {
  return store.purge(new Date(now.getTime() - PROXIMITY_EVENT_RETENTION_DAYS * 24 * HOUR_MS));
}
