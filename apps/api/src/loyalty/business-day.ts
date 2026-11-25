/**
 * Journée comptable Splash360 (réponse de Splash360 du 25/11, ADR 0025) : une vente faite avant
 * 02:00, heure de Paris, appartient à la veille ; à partir de 02:00, à sa journée du calendrier.
 * Les changements d'heure sont pris en compte par le fuseau `Europe/Paris`.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Paris';
/** Heure (Paris) à laquelle commence une journée comptable : « HH:MM ». */
export const BUSINESS_DAY_CUTOFF = '02:00';

/** Date (AAAA-MM-JJ) et heure (HH:MM) de `at` à l'heure de Paris. */
export function parisDateTime(at: Date): { readonly date: string; readonly time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Journée du calendrier décalée de `n` jours (AAAA-MM-JJ). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Écart en jours entre deux journées (a − b). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Journée comptable d'une date et d'une heure de Paris. */
export function businessDayOf(date: string, time: string): string {
  return time < BUSINESS_DAY_CUTOFF ? addDays(date, -1) : date;
}

/** Journée comptable de l'instant `at`. */
export function businessDay(at: Date): string {
  const { date, time } = parisDateTime(at);
  return businessDayOf(date, time);
}

/**
 * Journées comptables possibles d'un ticket : une seule si l'heure imprimée est lue, sinon la
 * date imprimée et la veille (la vente a pu être faite entre minuit et 02:00).
 */
export function receiptBusinessDays(date: string, time: string | null): readonly string[] {
  return time ? [businessDayOf(date, time)] : [date, addDays(date, -1)];
}

/**
 * Journée terminée : à partir de 02:00 (Paris) le lendemain, plus aucune vente ne peut s'y ajouter.
 */
export function isBusinessDayOver(day: string, now: Date): boolean {
  return day < businessDay(now);
}
