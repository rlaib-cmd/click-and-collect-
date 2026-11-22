import type { MenuCache } from '@splash360/api-menu';
import type {
  OperationsStore,
  OrderingStore,
  OrderReader,
  PaymentStore,
  RestaurantStore,
  TenantStore,
} from '@splash360/db';
import type { NotificationSender } from './notifications/sender';
import { notifyStatus, tenantNameResolver } from './notifications/service';
import type { PaymentGateway } from './payments/gateway';
import { processDispatches } from './pos/dispatcher';
import type { PosGateway } from './pos/gateway';
import { posRoutes } from './routes/pos';
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
  readonly operations: OperationsStore;
  readonly pos: PosGateway;
  readonly notifier: NotificationSender;
  /** Secret partagé avec la caisse Splash360 pour les retours de statut ; null = désactivé. */
  readonly posWebhookSecret?: string | null;
  /** Appelé en plus après un paiement confirmé (tests). */
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

  const warn = (m: string, d?: Record<string, unknown>) => console.warn(m, d);
  const notify = {
    operations: deps.operations,
    orders: deps.orders,
    tenantName: tenantNameResolver(deps.tenants),
    notifier: deps.notifier,
    log: warn,
  };
  const dispatch = {
    operations: deps.operations,
    orders: deps.orders,
    restaurants: deps.restaurants,
    pos: deps.pos,
    log: warn,
  };

  // Paiement confirmé : reçu au client, puis envoi immédiat à la caisse (la tâche périodique rattrape les échecs).
  const onPaid = async (order: { orderId: string; tenantId: string }) => {
    await notifyStatus(notify, order.tenantId, order.orderId, 'paid');
    await processDispatches(dispatch).catch((error: unknown) =>
      warn('Envoi immédiat à la caisse en échec', { error: String(error) }),
    );
    await deps.onPaid?.(order);
  };

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route(
    '/v1/webhooks',
    webhookRoutes({
      payments: deps.payments,
      gateway: deps.gateway,
      log: warn,
      onPaid,
    }),
  );
  app.route('/v1/pos', posRoutes({ ...notify, posWebhookSecret: deps.posWebhookSecret ?? null }));
  app.route('/v1/tenants', tenantRoutes({ ...deps, now: deps.now ?? (() => new Date()) }));

  app.notFound((c) => apiError(c, 'not_found', 'Route inconnue'));
  app.onError((err, c) => {
    console.error(err);
    return apiError(c, 'internal_error', 'Erreur interne');
  });

  return app;
}
