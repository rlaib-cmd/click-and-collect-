import type { MenuCache } from '@splash360/api-menu';
import type {
  OrderingStore,
  OrderReader,
  PaymentStore,
  RestaurantStore,
  TenantStore,
} from '@splash360/db';
import type { PaymentGateway } from './payments/gateway';
import type { GeoProvider } from './geo';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { apiError } from './errors';
import { tenantRoutes } from './routes/tenants';
import { webhookRoutes } from './routes/webhooks';

export interface AppDeps {
  readonly tenants: TenantStore;
  readonly restaurants: RestaurantStore;
  readonly menus: MenuCache;
  readonly ordering: OrderingStore;
  readonly geo: GeoProvider;
  readonly payments: PaymentStore;
  readonly orders: OrderReader;
  /** null : paiement non configuré (clés Stripe absentes). */
  readonly gateway: PaymentGateway | null;
  readonly tokenSecret: string;
  readonly onPaid?: (order: { orderId: string; tenantId: string }) => Promise<void>;
  readonly now?: () => Date;
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
    cors({
      origin: origins === '*' ? '*' : [...origins],
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route(
    '/v1/webhooks',
    webhookRoutes({
      payments: deps.payments,
      gateway: deps.gateway,
      log: (m, d) => console.warn(m, d),
      ...(deps.onPaid ? { onPaid: deps.onPaid } : {}),
    }),
  );
  app.route('/v1/tenants', tenantRoutes({ ...deps, now: deps.now ?? (() => new Date()) }));

  app.notFound((c) => apiError(c, 'not_found', 'Route inconnue'));
  app.onError((err, c) => {
    console.error(err);
    return apiError(c, 'internal_error', 'Erreur interne');
  });

  return app;
}
