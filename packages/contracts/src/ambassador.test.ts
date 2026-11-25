import { describe, expect, it } from 'vitest';
import {
  ambassadorEntryRequestSchema,
  ambassadorSettingsSchema,
  instagramHandleSchema,
} from './ambassador';

describe('ambassadeur : saisies normalisées', () => {
  it('enregistre le compte Instagram sans « @ » (retour testeur Bills Burger)', () => {
    expect(instagramHandleSchema.parse('@billsburgerfr')).toBe('billsburgerfr');
    expect(instagramHandleSchema.parse('  billsburgerfr ')).toBe('billsburgerfr');
    expect(instagramHandleSchema.safeParse('bills burger').success).toBe(false);
  });

  it('normalise le numéro de ticket et refuse un numéro farfelu', () => {
    expect(
      ambassadorEntryRequestSchema.parse({ ticketRef: ' bb 1042 ', instagramHandle: '@moi' }),
    ).toEqual({ ticketRef: 'BB1042', instagramHandle: 'moi' });
    expect(
      ambassadorEntryRequestSchema.safeParse({ ticketRef: '<script>', instagramHandle: 'moi' })
        .success,
    ).toBe(false);
  });

  it('exige un compte à taguer pour activer la fonction', () => {
    expect(
      ambassadorSettingsSchema.safeParse({ enabled: true, instagramHandle: null, bonusPoints: 50 })
        .success,
    ).toBe(false);
    expect(
      ambassadorSettingsSchema.parse({ enabled: true, instagramHandle: '@bills', bonusPoints: 50 }),
    ).toEqual({ enabled: true, instagramHandle: 'bills', bonusPoints: 50 });
  });
});
