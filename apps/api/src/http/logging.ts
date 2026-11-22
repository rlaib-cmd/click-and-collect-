import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

export type Log = (
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: Record<string, unknown>,
) => void;

/** Journal JSON sur une ligne (lisible par tout collecteur), sans donnée personnelle. */
export const jsonLog: Log = (level, message, detail) => {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...detail });
  if (level === 'error') console.error(line);
  else console.log(line);
};

/** Identifiant de requête (repris de X-Request-Id ou généré) et ligne de journal par requête. */
export function requestLogger(log: Log): MiddlewareHandler<{ Variables: { requestId: string } }> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    const start = performance.now();
    await next();
    // Chemin sans paramètres de requête : ni recherche client ni jeton dans les journaux.
    log(c.res.status >= 500 ? 'error' : 'info', 'requête', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    });
  };
}
