import type { Context, MiddlewareHandler } from 'hono';
import { apiError } from '../errors';

export interface RateLimitOptions {
  /** Requêtes autorisées par fenêtre. */
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Derrière un proxy de confiance : `true` lit l'en-tête `ipHeader` posé par l'hébergeur (sinon
   * la DERNIÈRE entrée d'X-Forwarded-For, ajoutée par le proxy). Jamais la première entrée, que le
   * client peut écrire lui-même (audit du 25/11, M2).
   */
  readonly trustProxy: boolean;
  /** En-tête posé par l'hébergeur et non falsifiable : `cf-connecting-ip` (Supabase Edge), `fly-client-ip` (Fly). */
  readonly ipHeader?: string | undefined;
  readonly now?: () => number;
}

export function clientIp(c: Context, trustProxy: boolean, ipHeader?: string): string {
  if (trustProxy) {
    const fromHost = ipHeader ? c.req.header(ipHeader)?.trim() : undefined;
    if (fromHost) return fromHost;
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'inconnue';
}

/**
 * Limitation de débit par adresse IP, fenêtre fixe, en mémoire.
 * Protège la création de commande, le paiement et le géocodeur des abus.
 * Plusieurs instances : chaque instance applique sa propre limite (à déplacer dans Redis si besoin).
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    const t = now();
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    const key = clientIp(c, options.trustProxy, options.ipHeader);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + options.windowMs });
    } else {
      entry.count += 1;
      if (entry.count > options.limit) {
        c.header('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
        return apiError(c, 'rate_limited', 'Trop de requêtes, réessayez dans un instant');
      }
    }
    await next();
  };
}
