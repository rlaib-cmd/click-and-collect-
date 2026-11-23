/**
 * Connexion du client par code à usage unique (lot 10, ADR 0012) : règles pures.
 * Le code part par SMS (identifiant = téléphone E.164) ou par e-mail.
 */

export const OTP_LENGTH = 6;
/** Durée de validité d'un code. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Essais de saisie par code avant qu'il soit inutilisable. */
export const OTP_MAX_ATTEMPTS = 5;
/** Délai minimal entre deux envois au même identifiant. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Envois maximum au même identifiant sur une heure glissante (coût des SMS). */
export const OTP_MAX_SENDS_PER_HOUR = 5;
/** Après vérification, délai pour finir l'inscription (prénom) avec le même code. */
export const OTP_COMPLETION_TTL_MS = 15 * 60 * 1000;

export type OtpChannel = 'sms' | 'email';

/**
 * Numéro de mobile ou fixe français au format international E.164 (+33XXXXXXXXX), ou null.
 * Accepte « 06 12 34 56 78 », « 0612345678 », « +33 6 12 34 56 78 », « 0033612345678 ».
 */
export function normalizeFrenchPhone(input: string): string | null {
  const compact = input.replace(/[\s.\-()]/g, '');
  let national: string | null = null;
  if (/^0[1-9]\d{8}$/.test(compact)) national = compact.slice(1);
  else if (/^\+33[1-9]\d{8}$/.test(compact)) national = compact.slice(3);
  else if (/^0033[1-9]\d{8}$/.test(compact)) national = compact.slice(4);
  return national ? `+33${national}` : null;
}

/** Numéro qui reçoit des SMS : mobile français (06, 07). */
export function isFrenchMobile(e164: string): boolean {
  return /^\+33[67]\d{8}$/.test(e164);
}

/** « +33 6 12 34 56 78 » → « 06 12 34 56 78 » (affichage). */
export function formatFrenchPhone(e164: string): string {
  const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : e164;
}

/** Identifiant de connexion normalisé, ou null s'il est invalide pour ce canal. */
export function normalizeOtpIdentifier(channel: OtpChannel, raw: string): string | null {
  if (channel === 'sms') {
    const phone = normalizeFrenchPhone(raw);
    return phone && isFrenchMobile(phone) ? phone : null;
  }
  const email = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 200 ? email : null;
}

/** Code à 6 chiffres à partir d'octets aléatoires (crypto côté serveur), sans biais notable. */
export function otpCodeFromRandom(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new Error('Au moins 4 octets aléatoires');
  const n =
    (((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)) >>>
    0;
  return String(n % 10 ** OTP_LENGTH).padStart(OTP_LENGTH, '0');
}

export function isOtpCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

export type OtpSendDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'cooldown' | 'hourly_limit';
      readonly retryAfterMs: number;
    };

/** Peut-on envoyer un nouveau code ? `recentSends` : dates des envois à cet identifiant (toutes, ou la dernière heure). */
export function canSendOtp(recentSends: readonly Date[], now: Date): OtpSendDecision {
  const t = now.getTime();
  const lastHour = recentSends.map((d) => d.getTime()).filter((s) => s > t - 3_600_000);
  const last = Math.max(...lastHour, -Infinity);
  if (last > t - OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown', retryAfterMs: last + OTP_RESEND_COOLDOWN_MS - t };
  }
  if (lastHour.length >= OTP_MAX_SENDS_PER_HOUR) {
    const oldest = Math.min(...lastHour);
    return { ok: false, reason: 'hourly_limit', retryAfterMs: oldest + 3_600_000 - t };
  }
  return { ok: true };
}

/** État d'un code envoyé, tel que conservé côté serveur. */
export interface OtpChallengeState {
  readonly createdAt: Date;
  readonly attempts: number;
  /** Code déjà validé (inscription en attente du prénom). */
  readonly verifiedAt: Date | null;
  /** Code utilisé jusqu'au bout (session ouverte). */
  readonly consumedAt: Date | null;
}

export type OtpCheck =
  | { readonly ok: true; readonly alreadyVerified: boolean }
  | { readonly ok: false; readonly reason: 'expired' | 'too_many_attempts' | 'consumed' };

/** Le code peut-il encore être essayé (avant comparaison) ? */
export function checkOtpChallenge(c: OtpChallengeState, now: Date): OtpCheck {
  const t = now.getTime();
  if (c.consumedAt) return { ok: false, reason: 'consumed' };
  if (c.verifiedAt) {
    return t <= c.verifiedAt.getTime() + OTP_COMPLETION_TTL_MS
      ? { ok: true, alreadyVerified: true }
      : { ok: false, reason: 'expired' };
  }
  if (t > c.createdAt.getTime() + OTP_TTL_MS) return { ok: false, reason: 'expired' };
  if (c.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  return { ok: true, alreadyVerified: false };
}

/** Nom d'expéditeur SMS : 3 à 11 caractères alphanumériques (règle des opérateurs). */
export function smsSenderName(brand: string): string {
  const s = brand
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 11);
  return s.length >= 3 ? s : 'Splash360';
}
