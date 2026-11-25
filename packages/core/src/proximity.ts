import { parseHHMM, toLocal } from './time';
import type { OpeningRange } from './slots';
import { distanceMeters } from './zones';

/**
 * Notifications « Bons plans à proximité » (lot 22, ADR 0027). Règles pures : l'application
 * signale l'entrée dans le rayon d'un restaurant, le serveur décide ici d'envoyer ou non un push.
 */

/** Écran ouvert par un appui sur la notification. */
export type ProximityDeepLink = 'home' | 'commander' | 'avantages';
export const PROXIMITY_DEEP_LINKS: readonly ProximityDeepLink[] = [
  'home',
  'commander',
  'avantages',
];

/** Membres visés : tous les inscrits, ceux qui ont un cadeau disponible, ou les inactifs. */
export type ProximityTarget = 'all' | 'reward' | 'inactive';
export const PROXIMITY_TARGETS: readonly ProximityTarget[] = ['all', 'reward', 'inactive'];

export const PROXIMITY_RADIUS_MIN = 100;
export const PROXIMITY_RADIUS_MAX = 1000;
/** Limite iOS des régions surveillées en même temps par une application. */
export const PROXIMITY_MAX_REGIONS = 20;
/** Durée de conservation des événements (aucun historique de position n'est gardé). */
export const PROXIMITY_EVENT_RETENTION_DAYS = 90;
/** Fenêtre d'attribution d'une commande à une notification. */
export const PROXIMITY_ATTRIBUTION_HOURS = 2;
/** Marque à remplacer par le nom du restaurant dans le titre et le texte. */
export const PROXIMITY_PLACEHOLDER = '{restaurant}';

export interface ProximityRules {
  readonly enabled: boolean;
  /** Rayon des zones, en mètres (100 à 1 000). */
  readonly radiusMeters: number;
  readonly title: string;
  readonly body: string;
  readonly deepLink: ProximityDeepLink;
  /** N'envoyer que pendant les horaires d'ouverture du restaurant concerné. */
  readonly onlyOpeningHours: boolean;
  /** Plage sans notification (heure locale du restaurant, HH:MM) ; peut passer minuit. */
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  /** Au plus une notification par membre sur cette durée, tous restaurants confondus. */
  readonly memberCapHours: number;
  /** Au plus une notification par membre et par restaurant sur cette durée. */
  readonly restaurantCapHours: number;
  readonly target: ProximityTarget;
  /** Cible « inactifs » : pas de commande depuis ce nombre de jours. */
  readonly inactiveDays: number;
}

export const DEFAULT_PROXIMITY_RULES: ProximityRules = {
  enabled: false,
  radiusMeters: 200,
  title: `${PROXIMITY_PLACEHOLDER} est tout près`,
  body: 'Une petite faim ? Commande en avance et passe la récupérer sans attendre.',
  deepLink: 'commander',
  onlyOpeningHours: true,
  quietHours: { start: '21:00', end: '09:00' },
  memberCapHours: 24,
  restaurantCapHours: 168,
  target: 'all',
  inactiveDays: 30,
};

export type ProximityReason =
  | 'sent'
  | 'disabled'
  | 'no_device'
  | 'restaurant_unavailable'
  | 'quiet_hours'
  | 'closed'
  | 'member_cap'
  | 'restaurant_cap'
  | 'no_reward'
  | 'loyalty_unavailable'
  | 'recently_active';

export const PROXIMITY_REASONS: readonly ProximityReason[] = [
  'sent',
  'disabled',
  'no_device',
  'restaurant_unavailable',
  'quiet_hours',
  'closed',
  'member_cap',
  'restaurant_cap',
  'no_reward',
  'loyalty_unavailable',
  'recently_active',
];

export interface ProximityContext {
  readonly now: Date;
  readonly restaurant: {
    /** Restaurant actif (ni en pause ni fermé) avec des coordonnées. */
    readonly available: boolean;
    readonly timezone: string;
    readonly openingHours: readonly OpeningRange[];
    /** Fermetures exceptionnelles (AAAA-MM-JJ, heure locale). */
    readonly closures: readonly string[];
  };
  /** Le membre a au moins un appareil inscrit (consentement donné dans l'application). */
  readonly hasDevice: boolean;
  /** Dernière notification envoyée au membre, tous restaurants confondus. */
  readonly lastSentToMember: Date | null;
  /** Dernière notification envoyée au membre pour ce restaurant. */
  readonly lastSentForRestaurant: Date | null;
  /** Solde de points ; null si la fidélité n'a pas répondu (lu seulement pour la cible « reward »). */
  readonly points: number | null;
  /** Coût du cadeau le moins cher ; null s'il n'y a aucun cadeau. */
  readonly cheapestRewardCost: number | null;
  /** Dernière commande du membre dans notre base ; null s'il n'a jamais commandé. */
  readonly lastOrderAt: Date | null;
}

export interface ProximityDecision {
  readonly send: boolean;
  readonly reason: ProximityReason;
}

const HOUR_MS = 3_600_000;

/** Minute locale dans une plage [start, end[ ; une plage dont la fin précède le début passe minuit. */
export function inDailyWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Restaurant ouvert à cet instant (heure locale, fermetures exceptionnelles comprises). */
export function isOpenAt(
  restaurant: Pick<ProximityContext['restaurant'], 'timezone' | 'openingHours' | 'closures'>,
  now: Date,
): boolean {
  const local = toLocal(now, restaurant.timezone);
  if (restaurant.closures.includes(local.date)) return false;
  return restaurant.openingHours.some(
    (r) =>
      r.isoWeekday === local.isoWeekday &&
      inDailyWindow(local.minutes, parseHHMM(r.opens), parseHHMM(r.closes)),
  );
}

const within = (last: Date | null, now: Date, hours: number) =>
  last !== null && now.getTime() - last.getTime() < hours * HOUR_MS;

/**
 * Décision d'envoi, dans cet ordre : fonction active, appareil inscrit, restaurant disponible,
 * heures calmes, horaires d'ouverture, plafond par membre, plafond par restaurant, puis cible.
 * Les plafonds ne comptent que les notifications réellement envoyées.
 */
export function decideProximityPush(
  rules: ProximityRules,
  ctx: ProximityContext,
): ProximityDecision {
  const no = (reason: ProximityReason): ProximityDecision => ({ send: false, reason });
  if (!rules.enabled) return no('disabled');
  if (!ctx.hasDevice) return no('no_device');
  if (!ctx.restaurant.available) return no('restaurant_unavailable');
  if (rules.quietHours) {
    const minutes = toLocal(ctx.now, ctx.restaurant.timezone).minutes;
    const start = parseHHMM(rules.quietHours.start);
    const end = parseHHMM(rules.quietHours.end);
    if (inDailyWindow(minutes, start, end)) return no('quiet_hours');
  }
  if (rules.onlyOpeningHours && !isOpenAt(ctx.restaurant, ctx.now)) return no('closed');
  if (within(ctx.lastSentToMember, ctx.now, rules.memberCapHours)) return no('member_cap');
  if (within(ctx.lastSentForRestaurant, ctx.now, rules.restaurantCapHours))
    return no('restaurant_cap');
  if (rules.target === 'reward') {
    if (ctx.points === null) return no('loyalty_unavailable');
    if (ctx.cheapestRewardCost === null || ctx.points < ctx.cheapestRewardCost)
      return no('no_reward');
  }
  if (rules.target === 'inactive' && within(ctx.lastOrderAt, ctx.now, rules.inactiveDays * 24)) {
    return no('recently_active');
  }
  return { send: true, reason: 'sent' };
}

/** Remplace `{restaurant}` par le nom du restaurant. */
export function renderProximityText(template: string, restaurantName: string): string {
  return template.split(PROXIMITY_PLACEHOLDER).join(restaurantName).trim();
}

/** Problèmes d'un jeu de règles (vide si valide) ; le contrat zod contrôle déjà les formats. */
export function proximityRulesIssues(rules: ProximityRules): string[] {
  const issues: string[] = [];
  if (
    !Number.isInteger(rules.radiusMeters) ||
    rules.radiusMeters < PROXIMITY_RADIUS_MIN ||
    rules.radiusMeters > PROXIMITY_RADIUS_MAX
  ) {
    issues.push('radius');
  }
  if (!rules.title.trim()) issues.push('title');
  if (!rules.body.trim()) issues.push('body');
  if (rules.quietHours && rules.quietHours.start === rules.quietHours.end)
    issues.push('quietHours');
  if (!Number.isInteger(rules.memberCapHours) || rules.memberCapHours < 1) issues.push('memberCap');
  if (!Number.isInteger(rules.restaurantCapHours) || rules.restaurantCapHours < 1)
    issues.push('restaurantCap');
  if (!Number.isInteger(rules.inactiveDays) || rules.inactiveDays < 1) issues.push('inactiveDays');
  return issues;
}

/**
 * Zones à surveiller : au plus `max` restaurants (limite iOS : 20), les plus proches d'abord
 * quand la position est connue, sinon dans l'ordre reçu.
 */
export function nearestRegions<T extends { readonly latitude: number; readonly longitude: number }>(
  places: readonly T[],
  origin: { readonly latitude: number; readonly longitude: number } | null,
  max: number = PROXIMITY_MAX_REGIONS,
): T[] {
  const limit = Math.max(0, Math.min(max, PROXIMITY_MAX_REGIONS));
  const valid = places.filter(
    (p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180,
  );
  if (!origin) return valid.slice(0, limit);
  return valid
    .map((p, i) => ({ p, i, d: distanceMeters(origin, p) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, limit)
    .map((x) => x.p);
}
