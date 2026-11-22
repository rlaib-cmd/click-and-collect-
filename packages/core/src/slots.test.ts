import { describe, expect, it } from 'vitest';
import {
  asapAvailability,
  bookableDates,
  checkRequestedTime,
  slotsForDate,
  type ScheduleSettings,
} from './slots';
import { fromLocal, offsetMs, toLocal } from './time';

const TZ = 'Europe/Paris';

// Midi 11:30–14:30 et soir 18:30–22:00, du mardi au dimanche ; fermé le lundi.
const settings: ScheduleSettings = {
  timezone: TZ,
  openingHours: [2, 3, 4, 5, 6, 7].flatMap((d) => [
    { isoWeekday: d, opens: '11:30', closes: '14:30' },
    { isoWeekday: d, opens: '18:30', closes: '22:00' },
  ]),
  closures: ['2026-12-25'],
  slotStepMinutes: 15,
  prepMinutes: 20,
  maxOrdersPerSlot: 3,
  daysAhead: 7,
};

/** Instant à partir d'une heure locale de Paris. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return fromLocal(date, h * 60 + m, TZ);
};

describe('fuseau horaire', () => {
  it('gère heure d’hiver et heure d’été', () => {
    expect(offsetMs(new Date('2026-01-15T12:00:00Z'), TZ)).toBe(3_600_000);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), TZ)).toBe(7_200_000);
    expect(at('2026-07-15', '12:00').toISOString()).toBe('2026-07-15T10:00:00.000Z');
    expect(at('2026-01-15', '12:00').toISOString()).toBe('2026-01-15T11:00:00.000Z');
    expect(toLocal(new Date('2026-11-24T23:30:00Z'), TZ)).toEqual({
      date: '2026-11-25',
      minutes: 30,
      isoWeekday: 3,
    });
  });

  it('reste juste un jour de changement d’heure', () => {
    // 29 mars 2026 : passage à l'heure d'été à 2 h.
    expect(at('2026-03-29', '12:00').toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(at('2026-03-29', '01:00').toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });
});

describe('créneaux', () => {
  const tuesday = '2026-11-24';

  it('génère les créneaux au pas réglé dans chaque plage', () => {
    const slots = slotsForDate(settings, tuesday, at('2026-11-23', '09:00'));
    const labels = slots.map((s) => s.label);
    expect(labels.slice(0, 3)).toEqual(['11:30', '11:45', '12:00']);
    expect(labels).toContain('14:30');
    expect(labels).not.toContain('14:45');
    expect(labels).toContain('18:30');
    expect(labels.at(-1)).toBe('22:00');
    expect(slots).toHaveLength(13 + 15);
    expect(slots[0]).toEqual({ at: '2026-11-24T10:30:00.000Z', label: '11:30', remaining: 3 });
  });

  it('écarte les créneaux passés ou trop proches (délai de préparation)', () => {
    const labels = slotsForDate(settings, tuesday, at(tuesday, '12:10')).map((s) => s.label);
    // 12:10 + 20 min = 12:30 → premier créneau 12:30.
    expect(labels[0]).toBe('12:30');
  });

  it('écarte les créneaux pleins et décompte les places', () => {
    const now = at('2026-11-23', '09:00');
    const first = at(tuesday, '11:30').toISOString();
    const second = at(tuesday, '11:45').toISOString();
    const slots = slotsForDate(settings, tuesday, now, { [first]: 3, [second]: 1 });
    expect(slots[0]).toMatchObject({ label: '11:45', remaining: 2 });
  });

  it('aucun créneau un jour fermé ou en fermeture exceptionnelle', () => {
    expect(slotsForDate(settings, '2026-11-23', at('2026-11-22', '09:00'))).toEqual([]); // lundi
    expect(slotsForDate(settings, '2026-12-25', at('2026-12-20', '09:00'))).toEqual([]);
  });

  it('propose aujourd’hui + jours d’avance, sans les jours sans créneau', () => {
    const dates = bookableDates(settings, at('2026-11-22', '23:00')); // dimanche soir
    expect(dates).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
  });

  it('0 jour d’avance désactive la planification', () => {
    expect(bookableDates({ ...settings, daysAhead: 0 }, at('2026-11-24', '09:00'))).toEqual([]);
  });
});

describe('dès que possible', () => {
  it('disponible pendant une plage si la commande est prête avant la fermeture', () => {
    const now = at('2026-11-24', '12:00');
    expect(asapAvailability(settings, now)).toEqual({
      available: true,
      estimatedAt: at('2026-11-24', '12:20').toISOString(),
    });
  });

  it('indisponible fermé, ou trop près de la fermeture', () => {
    expect(asapAvailability(settings, at('2026-11-24', '16:00')).available).toBe(false);
    expect(asapAvailability(settings, at('2026-11-24', '14:20')).available).toBe(false);
    expect(asapAvailability(settings, at('2026-11-23', '12:00')).available).toBe(false); // lundi
  });
});

describe('contrôle de l’heure demandée avant paiement', () => {
  const now = at('2026-11-24', '10:00');

  it('accepte un créneau proposé, refuse un créneau inventé ou plein', () => {
    const slot = at('2026-11-24', '12:00').toISOString();
    expect(checkRequestedTime(settings, { kind: 'scheduled', at: slot }, now)).toEqual({
      ok: true,
      at: slot,
      slot,
    });
    const offGrid = at('2026-11-24', '12:07').toISOString();
    expect(checkRequestedTime(settings, { kind: 'scheduled', at: offGrid }, now)).toEqual({
      ok: false,
      error: 'slot_unavailable',
    });
    expect(
      checkRequestedTime(settings, { kind: 'scheduled', at: slot }, now, { [slot]: 3 }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      checkRequestedTime(settings, { kind: 'scheduled', at: 'pas une date' }, now),
    ).toMatchObject({ ok: false });
  });

  it('refuse au-delà des jours d’avance', () => {
    const far = at('2026-12-08', '12:00').toISOString();
    expect(checkRequestedTime(settings, { kind: 'scheduled', at: far }, now)).toEqual({
      ok: false,
      error: 'slot_unavailable',
    });
  });

  it('restaurant fermé : « dès que possible » refusé, planifié accepté', () => {
    expect(checkRequestedTime(settings, { kind: 'asap' }, now)).toEqual({
      ok: false,
      error: 'restaurant_closed',
    });
    const slot = at('2026-11-24', '11:30').toISOString();
    expect(checkRequestedTime(settings, { kind: 'scheduled', at: slot }, now).ok).toBe(true);
  });

  it('planification désactivée', () => {
    const slot = at('2026-11-24', '12:00').toISOString();
    expect(
      checkRequestedTime({ ...settings, daysAhead: 0 }, { kind: 'scheduled', at: slot }, now),
    ).toEqual({
      ok: false,
      error: 'scheduling_disabled',
    });
  });
});
