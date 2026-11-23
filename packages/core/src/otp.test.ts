import { describe, expect, it } from 'vitest';
import {
  OTP_MAX_ATTEMPTS,
  canSendOtp,
  checkOtpChallenge,
  formatFrenchPhone,
  isOtpCodeFormat,
  normalizeFrenchPhone,
  normalizeOtpIdentifier,
  otpCodeFromRandom,
  smsSenderName,
} from './otp';

const at = (iso: string) => new Date(iso);

describe('normalizeFrenchPhone', () => {
  it.each([
    ['06 12 34 56 78', '+33612345678'],
    ['0612345678', '+33612345678'],
    ['07.12.34.56.78', '+33712345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['01 23 45 67 89', '+33123456789'],
  ])('%s → %s', (input, expected) => expect(normalizeFrenchPhone(input)).toBe(expected));

  it.each(['612345678', '06123456789', '+44 7700 900123', '00 12 34 56 78', 'abc', ''])(
    'refuse %s',
    (input) => expect(normalizeFrenchPhone(input)).toBeNull(),
  );

  it('formate pour l’affichage', () => {
    expect(formatFrenchPhone('+33612345678')).toBe('06 12 34 56 78');
  });
});

describe('normalizeOtpIdentifier', () => {
  it('SMS : uniquement un mobile', () => {
    expect(normalizeOtpIdentifier('sms', '06 12 34 56 78')).toBe('+33612345678');
    expect(normalizeOtpIdentifier('sms', '01 23 45 67 89')).toBeNull();
  });
  it('e-mail : en minuscules', () => {
    expect(normalizeOtpIdentifier('email', ' Jo@Exemple.FR ')).toBe('jo@exemple.fr');
    expect(normalizeOtpIdentifier('email', 'pas-un-email')).toBeNull();
  });
});

describe('code', () => {
  it('six chiffres, zéros conservés', () => {
    expect(otpCodeFromRandom(new Uint8Array([0, 0, 0, 7]))).toBe('000007');
    expect(isOtpCodeFormat(otpCodeFromRandom(new Uint8Array([255, 255, 255, 255])))).toBe(true);
  });
  it('format', () => {
    expect(isOtpCodeFormat('123456')).toBe(true);
    expect(isOtpCodeFormat('12345')).toBe(false);
    expect(isOtpCodeFormat('12345a')).toBe(false);
  });
});

describe('canSendOtp', () => {
  const now = at('2026-11-23T10:00:00Z');
  it('premier envoi autorisé', () => expect(canSendOtp([], now)).toEqual({ ok: true }));
  it('attendre 60 s entre deux envois', () => {
    const r = canSendOtp([at('2026-11-23T09:59:30Z')], now);
    expect(r).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: 30_000 });
  });
  it('5 envois par heure au plus', () => {
    const sends = ['09:10', '09:20', '09:30', '09:40', '09:50'].map((h) =>
      at(`2026-11-23T${h}:00Z`),
    );
    expect(canSendOtp(sends, now)).toEqual({
      ok: false,
      reason: 'hourly_limit',
      retryAfterMs: 10 * 60_000,
    });
  });
  it('les envois de plus d’une heure ne comptent pas', () => {
    const sends = ['08:10', '08:20', '08:30', '08:40', '09:50'].map((h) =>
      at(`2026-11-23T${h}:00Z`),
    );
    expect(canSendOtp(sends, now)).toEqual({ ok: true });
  });
});

describe('checkOtpChallenge', () => {
  const base = {
    createdAt: at('2026-11-23T10:00:00Z'),
    attempts: 0,
    verifiedAt: null,
    consumedAt: null,
  };
  it('valable 10 minutes', () => {
    expect(checkOtpChallenge(base, at('2026-11-23T10:09:59Z'))).toEqual({
      ok: true,
      alreadyVerified: false,
    });
    expect(checkOtpChallenge(base, at('2026-11-23T10:10:01Z'))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
  it('5 essais au plus', () => {
    expect(
      checkOtpChallenge({ ...base, attempts: OTP_MAX_ATTEMPTS }, at('2026-11-23T10:01:00Z')),
    ).toEqual({ ok: false, reason: 'too_many_attempts' });
  });
  it('un code utilisé ne resert pas', () => {
    expect(
      checkOtpChallenge(
        { ...base, consumedAt: at('2026-11-23T10:01:00Z') },
        at('2026-11-23T10:02:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'consumed' });
  });
  it('code validé : 15 minutes pour finir l’inscription', () => {
    const verified = { ...base, verifiedAt: at('2026-11-23T10:05:00Z') };
    expect(checkOtpChallenge(verified, at('2026-11-23T10:19:00Z'))).toEqual({
      ok: true,
      alreadyVerified: true,
    });
    expect(checkOtpChallenge(verified, at('2026-11-23T10:21:00Z'))).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('smsSenderName', () => {
  it('11 caractères alphanumériques sans accents', () => {
    expect(smsSenderName('Bills Burger')).toBe('BillsBurger');
    expect(smsSenderName('Pizzéria Bella & Co')).toBe('PizzeriaBel');
    expect(smsSenderName('A!')).toBe('Splash360');
  });
});
