import { describe, expect, it } from 'vitest';
import {
  ambassadorEntryRequestSchema,
  ambassadorSettingsSchema,
  instagramHandleSchema,
  ticketQrSchema,
  ticketIdFromQr,
  ticketRefFromQr,
  ticketRefSchema,
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

describe('référence de ticket tirée du QR code', () => {
  it('reprend un numéro de ticket déjà au bon format', () => {
    expect(ticketRefFromQr(' bb-1042 ')).toBe('BB-1042');
  });

  it('lit le numéro dans une URL (paramètre connu, sinon dernier segment)', () => {
    expect(ticketRefFromQr('https://example.test/t?ticket=bb-2042')).toBe('BB-2042');
    expect(ticketRefFromQr('https://example.test/t?x=1&numero=A123')).toBe('A123');
    expect(ticketRefFromQr('https://example.test/tickets/BB-3042')).toBe('BB-3042');
  });

  it('donne une empreinte stable et distincte pour un contenu non conforme', () => {
    const a = ticketRefFromQr('{"caisse":7,"montant":"14,90"}');
    expect(a).toMatch(/^QR-[0-9A-F]{16}$/);
    expect(ticketRefFromQr('{"caisse":7,"montant":"14,90"}')).toBe(a);
    expect(ticketRefFromQr('{"caisse":7,"montant":"14,91"}')).not.toBe(a);
    expect(ticketRefSchema.safeParse(a).success).toBe(true);
    // Empreinte FNV-1a 64 bits de référence (chaîne vide).
    expect(ticketRefFromQr('https://')).toMatch(/^QR-/);
  });

  it('reconnaît un identifiant de vente Splash360 (lot 20), seul ou dans une URL', () => {
    const id = '6f1c1c2e-0000-4000-8000-00000000000b';
    expect(ticketIdFromQr(id.toUpperCase())).toBe(id);
    expect(ticketIdFromQr(`https://borne.test/t?ticket=${id}&x=1`)).toBe(id);
    expect(ticketIdFromQr(`https://borne.test/t%2F${id}`)).toBe(id);
    expect(ticketIdFromQr('BB-1042')).toBeNull();
    expect(ticketRefFromQr(`https://borne.test/tickets/${id}`)).toBe(id.toUpperCase());
    expect(ticketRefSchema.safeParse(id.toUpperCase()).success).toBe(true);
  });

  it('accepte un contenu de QR brut raisonnable et refuse un contenu trop long', () => {
    expect(ticketQrSchema.safeParse('https://example.test/t?ticket=BB-2042').success).toBe(true);
    expect(ticketQrSchema.safeParse('x'.repeat(513)).success).toBe(false);
    expect(ticketQrSchema.safeParse('\u0000\u0001').success).toBe(false);
  });
});
