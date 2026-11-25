import { describe, expect, it } from 'vitest';
import {
  BUSINESS_DAY_CUTOFF,
  addDays,
  businessDay,
  businessDayOf,
  isBusinessDayOver,
  receiptBusinessDays,
} from './business-day';

/** Journée comptable Splash360 : coupure à 02:00, heure de Paris (ADR 0025). */
describe('journée comptable', () => {
  it('coupure à 02:00 : 01:59 appartient à la veille, 02:00 à la journée', () => {
    expect(BUSINESS_DAY_CUTOFF).toBe('02:00');
    expect(businessDayOf('2026-11-25', '01:59')).toBe('2026-11-24');
    expect(businessDayOf('2026-11-25', '02:00')).toBe('2026-11-25');
    expect(businessDayOf('2026-11-25', '00:00')).toBe('2026-11-24');
    expect(businessDayOf('2026-11-25', '23:59')).toBe('2026-11-25');
    // Heure d'hiver (UTC+1) : 01:59 Paris = 00:59 UTC.
    expect(businessDay(new Date('2026-11-25T00:59:00Z'))).toBe('2026-11-24');
    expect(businessDay(new Date('2026-11-25T01:00:00Z'))).toBe('2026-11-25');
    // Heure d'été (UTC+2).
    expect(businessDay(new Date('2026-07-15T23:59:00Z'))).toBe('2026-07-15'); // 01:59 le 16
    expect(businessDay(new Date('2026-07-16T00:00:00Z'))).toBe('2026-07-16'); // 02:00 le 16
  });

  it('changements d’heure : passage à l’heure d’été puis à l’heure d’hiver', () => {
    // 29/03/2026 : 02:00 → 03:00. 01:59 (UTC+1) = veille, 03:00 (UTC+2) = journée.
    expect(businessDay(new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-28');
    expect(businessDay(new Date('2026-03-29T01:00:00Z'))).toBe('2026-03-29');
    // 25/10/2026 : 03:00 → 02:00. 01:59 (UTC+2) = veille ; 02:00 (UTC+2) = journée ;
    // l'heure 02:xx répétée (UTC+1) aussi.
    expect(businessDay(new Date('2026-10-24T23:59:00Z'))).toBe('2026-10-24');
    expect(businessDay(new Date('2026-10-25T00:00:00Z'))).toBe('2026-10-25');
    expect(businessDay(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
  });

  it('heure lue : une journée ; heure illisible : la date et la veille', () => {
    expect(receiptBusinessDays('2026-11-25', '01:30')).toEqual(['2026-11-24']);
    expect(receiptBusinessDays('2026-11-25', '12:00')).toEqual(['2026-11-25']);
    expect(receiptBusinessDays('2026-11-25', null)).toEqual(['2026-11-25', '2026-11-24']);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('journée terminée seulement à 02:00 le lendemain', () => {
    expect(isBusinessDayOver('2026-11-24', new Date('2026-11-24T23:30:00Z'))).toBe(false); // 00:30
    expect(isBusinessDayOver('2026-11-24', new Date('2026-11-25T00:59:00Z'))).toBe(false); // 01:59
    expect(isBusinessDayOver('2026-11-24', new Date('2026-11-25T01:00:00Z'))).toBe(true); // 02:00
  });
});
