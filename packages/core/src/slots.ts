import { addDays, formatHHMM, fromLocal, isoWeekdayOf, parseHHMM, toLocal } from './time';

/** Plage de commande d'un jour de la semaine (ex. 11:30 → 14:30). */
export interface OpeningRange {
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  readonly isoWeekday: number;
  readonly opens: string;
  readonly closes: string;
}

export type SlotStep = 10 | 15 | 30;

export interface ScheduleSettings {
  readonly timezone: string;
  readonly openingHours: readonly OpeningRange[];
  /** Fermetures exceptionnelles, journées entières (AAAA-MM-JJ, heure locale). */
  readonly closures: readonly string[];
  readonly slotStepMinutes: SlotStep;
  /** Délai de préparation (et de livraison le cas échéant), en minutes. */
  readonly prepMinutes: number;
  /** Commandes maximum par créneau ; null = illimité. */
  readonly maxOrdersPerSlot: number | null;
  /** Jours d'avance proposés ; 0 désactive la commande planifiée. */
  readonly daysAhead: number;
}

export interface Slot {
  /** Heure demandée (instant UTC, ISO 8601). */
  readonly at: string;
  /** Heure locale affichée, HH:MM. */
  readonly label: string;
  /** Places restantes ; null = illimité. */
  readonly remaining: number | null;
}

/** Nombre de commandes déjà prises par créneau, indexé par `Slot.at`. */
export type SlotLoad = Readonly<Record<string, number>>;

function rangesFor(settings: ScheduleSettings, date: string) {
  if (settings.closures.includes(date)) return [];
  const weekday = isoWeekdayOf(date);
  return settings.openingHours
    .filter((r) => r.isoWeekday === weekday)
    .map((r) => ({ opens: parseHHMM(r.opens), closes: parseHHMM(r.closes) }))
    .filter((r) => r.closes > r.opens)
    .sort((a, b) => a.opens - b.opens);
}

/**
 * Créneaux proposés pour une date locale. Un créneau est une heure de retrait ou de livraison
 * comprise dans une plage de commande, espacée du pas réglé à partir de l'ouverture.
 * Ne sont pas proposés : les créneaux passés, ceux plus proches que le délai de préparation,
 * et ceux qui ont atteint le maximum de commandes.
 */
export function slotsForDate(
  settings: ScheduleSettings,
  date: string,
  now: Date,
  load: SlotLoad = {},
): Slot[] {
  const earliest = now.getTime() + settings.prepMinutes * 60_000;
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const range of rangesFor(settings, date)) {
    for (let m = range.opens; m <= range.closes; m += settings.slotStepMinutes) {
      const instant = fromLocal(date, m, settings.timezone);
      if (instant.getTime() < earliest) continue;
      const at = instant.toISOString();
      if (seen.has(at)) continue;
      seen.add(at);
      const taken = load[at] ?? 0;
      const remaining =
        settings.maxOrdersPerSlot === null ? null : settings.maxOrdersPerSlot - taken;
      if (remaining !== null && remaining <= 0) continue;
      slots.push({ at, label: formatHHMM(m), remaining });
    }
  }
  return slots;
}

/** Dates (locales) proposées à la commande planifiée : aujourd'hui + jours d'avance, celles qui ont au moins un créneau. */
export function bookableDates(
  settings: ScheduleSettings,
  now: Date,
  load: SlotLoad = {},
): string[] {
  if (settings.daysAhead <= 0) return [];
  const today = toLocal(now, settings.timezone).date;
  const dates: string[] = [];
  for (let i = 0; i <= settings.daysAhead; i += 1) {
    const date = addDays(today, i);
    if (slotsForDate(settings, date, now, load).length > 0) dates.push(date);
  }
  return dates;
}

export type AsapResult =
  { readonly available: true; readonly estimatedAt: string } | { readonly available: false };

/**
 * « Dès que possible » : seulement si le restaurant est dans une plage de commande maintenant
 * et que la commande peut être prête avant la fermeture de cette plage.
 */
export function asapAvailability(settings: ScheduleSettings, now: Date): AsapResult {
  const local = toLocal(now, settings.timezone);
  const ready = local.minutes + settings.prepMinutes;
  const open = rangesFor(settings, local.date).some(
    (r) => local.minutes >= r.opens && ready <= r.closes,
  );
  if (!open) return { available: false };
  return {
    available: true,
    estimatedAt: new Date(now.getTime() + settings.prepMinutes * 60_000).toISOString(),
  };
}

export type RequestedTime =
  { readonly kind: 'asap' } | { readonly kind: 'scheduled'; readonly at: string };

export type TimeCheck =
  | { readonly ok: true; readonly at: string; readonly slot: string | null }
  | {
      readonly ok: false;
      readonly error: 'restaurant_closed' | 'scheduling_disabled' | 'slot_unavailable';
    };

/** Contrôle serveur de l'heure demandée, juste avant le paiement. */
export function checkRequestedTime(
  settings: ScheduleSettings,
  requested: RequestedTime,
  now: Date,
  load: SlotLoad = {},
): TimeCheck {
  if (requested.kind === 'asap') {
    const asap = asapAvailability(settings, now);
    return asap.available
      ? { ok: true, at: asap.estimatedAt, slot: null }
      : { ok: false, error: 'restaurant_closed' };
  }
  if (settings.daysAhead <= 0) return { ok: false, error: 'scheduling_disabled' };
  const at = new Date(requested.at);
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'slot_unavailable' };
  const date = toLocal(at, settings.timezone).date;
  const today = toLocal(now, settings.timezone).date;
  if (date > addDays(today, settings.daysAhead)) return { ok: false, error: 'slot_unavailable' };
  const iso = at.toISOString();
  const found = slotsForDate(settings, date, now, load).some((s) => s.at === iso);
  return found ? { ok: true, at: iso, slot: iso } : { ok: false, error: 'slot_unavailable' };
}
