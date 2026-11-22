/**
 * Fuseaux horaires sans dépendance : conversions entre instants (Date, UTC)
 * et heure locale d'un restaurant (par défaut Europe/Paris), changements d'heure compris.
 */

export interface LocalParts {
  readonly date: string; // AAAA-MM-JJ
  readonly minutes: number; // minutes depuis minuit
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  readonly isoWeekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function partsOf(instant: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Décalage du fuseau à cet instant, en millisecondes (ex. +3 600 000 à Paris en hiver). */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = partsOf(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocal(instant: Date, timeZone: string): LocalParts {
  const p = partsOf(instant, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute,
    isoWeekday: weekday === 0 ? 7 : weekday,
  };
}

/** Instant correspondant à une date et une heure locales (minutes depuis minuit). */
export function fromLocal(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Second passage pour les jours de changement d'heure.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** « 11:30 » → 690. */
export function parseHHMM(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError(`Heure invalide : « ${value} » (format HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatHHMM(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
