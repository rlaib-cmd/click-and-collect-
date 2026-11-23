import { normalizeFrenchPhone } from './otp';

/**
 * Clé qui identifie un client final dans une enseigne (ADR 0013) : son e-mail s'il en donne un,
 * sinon son téléphone (format international pour un numéro français, chiffres seuls sinon).
 * null si ni l'un ni l'autre n'est exploitable.
 */
export function customerContactKey(input: {
  readonly email: string | null;
  readonly phone: string;
}): string | null {
  const email = input.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = normalizeFrenchPhone(input.phone) ?? input.phone.replace(/[^0-9+]/g, '');
  return phone.replace(/\D/g, '').length >= 6 ? `tel:${phone}` : null;
}
