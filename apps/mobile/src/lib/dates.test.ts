import { describe, expect, it } from 'vitest';
import { formatDay, formatTime, localDate } from './dates';

const TZ = 'Europe/Paris';
const labels = { today: "Aujourd'hui", tomorrow: 'Demain' };

describe('dates du restaurant', () => {
  it('affiche l’heure locale', () => {
    expect(formatTime('2026-11-24T11:00:00.000Z', TZ)).toBe('12:00');
    expect(formatTime('2026-07-14T10:30:00.000Z', TZ)).toBe('12:30');
  });

  it('donne la date locale, même juste avant minuit UTC', () => {
    expect(localDate(new Date('2026-11-24T23:30:00Z'), TZ)).toBe('2026-11-25');
  });

  it('nomme les jours', () => {
    const now = new Date('2026-11-24T09:00:00Z');
    expect(formatDay('2026-11-24', now, TZ, labels)).toBe("Aujourd'hui");
    expect(formatDay('2026-11-25', now, TZ, labels)).toBe('Demain');
    expect(formatDay('2026-11-26', now, TZ, labels)).toBe('jeu. 26 nov.');
  });
});
