import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton de suivi d'une commande, remis au client à sa création (en-tête Authorization: Bearer).
 * Dérivé de l'identifiant par HMAC : un renvoi idempotent redonne le même jeton.
 * La base n'en garde que l'empreinte SHA-256.
 */
export function orderAccessToken(secret: string, orderId: string): string {
  return createHmac('sha256', secret).update(`order:${orderId}`).digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparaison en temps constant avec l'empreinte stockée. */
export function tokenMatches(token: string | undefined, hash: string | null): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lit « Authorization: Bearer <jeton> ». */
export function bearer(header: string | undefined): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header ?? '')?.[1];
}
