import type { TenantStore } from '@splash360/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { apiError } from './errors';
import { tenantRoutes } from './routes/tenants';

export interface AppDeps {
  readonly tenants: TenantStore;
  readonly corsOrigins?: readonly string[] | '*';
  readonly log?: boolean;
}

/**
 * Serveur de la commande en ligne. Les dépendances sont injectées
 * pour tester les routes sans base (ADR 0003).
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  if (deps.log) app.use(logger());
  app.use(secureHeaders());
  const origins = deps.corsOrigins ?? '*';
  app.use(
    '/v1/*',
    cors({ origin: origins === '*' ? '*' : [...origins], allowMethods: ['GET', 'POST'] }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/v1/tenants', tenantRoutes(deps.tenants));

  app.notFound((c) => apiError(c, 'not_found', 'Route inconnue'));
  app.onError((err, c) => {
    console.error(err);
    return apiError(c, 'internal_error', 'Erreur interne');
  });

  return app;
}
