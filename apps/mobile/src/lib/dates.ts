const pad = (n: number) => String(n).padStart(2, '0');

/** « 12:00 » dans le fuseau du restaurant. */
export function formatTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau du restaurant. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** « Aujourd'hui », « Demain », puis « jeu. 26 nov. ». */
export function formatDay(
  date: string,
  now: Date,
  timeZone: string,
  labels: { today: string; tomorrow: string },
): string {
  const today = localDate(now, timeZone);
  if (date === today) return labels.today;
  if (date === addDays(today, 1)) return labels.tomorrow;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
