import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Durée de validité d'un lien d'aperçu du brouillon (lot 12, ADR 0016). */
export const PREVIEW_TTL_MS = 30 * 60_000;

const sign = (secret: string, tenantId: string, expiresAt: number) =>
  createHmac('sha256', secret).update(`theme-preview:${tenantId}:${expiresAt}`).digest('base64url');

/** Jeton `<expiration en ms>.<signature>`, propre à une enseigne. */
export function createPreviewToken(secret: string, tenantId: string, now: Date): string {
  const expiresAt = now.getTime() + PREVIEW_TTL_MS;
  return `${expiresAt}.${sign(secret, tenantId, expiresAt)}`;
}

/** Vrai si le jeton a été émis pour cette enseigne et n'a pas expiré. */
export function isValidPreviewToken(
  secret: string,
  tenantId: string,
  token: string | undefined,
  now: Date,
): boolean {
  if (!token || token.length > 200) return false;
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!match?.[1] || !match[2]) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now.getTime()) return false;
  // Un jeton daté trop loin dans le futur n'a pas été émis par nous.
  if (expiresAt > now.getTime() + PREVIEW_TTL_MS) return false;
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(secret, tenantId, expiresAt));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
