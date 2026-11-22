import type { MenuCache } from '@splash360/api-menu';
import type {
  AdminStore,
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
import type { TokenVerifier } from './admin/auth';
import { adminRoutes } from './routes/admin';
import type { GeoProvider } from './geo';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { apiError } from './errors';
import { jsonLog, requestLogger, type Log } from './http/logging';
import { rateLimit } from './http/rate-limit';
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
  readonly admin: AdminStore;
  /** Vérification des jetons de session du back-office (Supabase Auth). */
  readonly verifier: TokenVerifier;
  /** URL publique du back-office. */
  readonly adminUrl?: string;
  /** Secret partagé avec la caisse Splash360 pour les retours de statut ; null = désactivé. */
  readonly posWebhookSecret?: string | null;
  /** Appelé en plus après un paiement confirmé (tests). */
  readonly onPaid?: (order: { orderId: string; tenantId: string }) => Promise<void>;
  readonly now?: () => Date;
  readonly corsOrigins?: readonly string[] | '*';
  /** Journal des requêtes (désactivé en test). */
  readonly log?: boolean;
  readonly logger?: Log;
  readonly reportError?: (error: Error) => void;
  /** Sonde de disponibilité (base de données). */
  readonly ready?: () => Promise<boolean>;
  /** Requêtes par minute et par IP : création/paiement/devis, et lectures publiques. */
  readonly rateLimits?: { orders: number; reads: number };
  readonly trustProxy?: boolean;
}

/**
 * Serveur de la commande en ligne. Les dépendances sont injectées
 * pour tester les routes sans base (ADR 0003).
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  const log = deps.logger ?? jsonLog;
  if (deps.log) app.use(requestLogger(log));
  app.use(secureHeaders());
  // Corps de requête limité (le webhook Stripe et l'export restent largement en dessous).
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => apiError(c, 'payload_too_large', 'Requête trop volumineuse'),
    }),
  );
  const origins = deps.corsOrigins ?? '*';
  app.use(
    '/v1/*',
    cors({
      origin: origins === '*' ? '*' : [...origins],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
    }),
  );

  const warn = (m: string, d?: Record<string, unknown>) => log('warn', m, d);

  // Limitation de débit des routes publiques sensibles (par adresse IP).
  const limits = deps.rateLimits ?? { orders: 20, reads: 300 };
  const trustProxy = deps.trustProxy ?? false;
  const strict = rateLimit({ limit: limits.orders, windowMs: 60_000, trustProxy });
  for (const path of [
    '/v1/tenants/:s/orders',
    '/v1/tenants/:s/orders/:id/payment',
    '/v1/tenants/:s/restaurants/:r/quote',
  ]) {
    app.on('POST', path, strict);
  }
  app.use('/v1/tenants/*', rateLimit({ limit: limits.reads, windowMs: 60_000, trustProxy }));
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
  /** Prêt à recevoir du trafic : la base répond. */
  app.get('/ready', async (c) =>
    (await (deps.ready?.() ?? Promise.resolve(true)))
      ? c.json({ status: 'ready' })
      : c.json({ status: 'unavailable' }, 503),
  );
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
  app.route(
    '/v1/admin',
    adminRoutes({
      ...notify,
      verifier: deps.verifier,
      admin: deps.admin,
      tenants: deps.tenants,
      restaurants: deps.restaurants,
      payments: deps.payments,
      gateway: deps.gateway,
      menus: deps.menus,
      adminUrl: deps.adminUrl ?? 'http://localhost:3000',
    }),
  );
  const hiddenItems = async (tenantId: string, restaurantId: string) => {
    const overrides = (await deps.admin.listMenuOverrides(tenantId, restaurantId)).filter(
      (o) => o.hidden,
    );
    return {
      products: new Set(overrides.filter((o) => o.kind === 'product').map((o) => o.itemId)),
      categories: new Set(overrides.filter((o) => o.kind === 'category').map((o) => o.itemId)),
    };
  };
  app.route(
    '/v1/tenants',
    tenantRoutes({ ...deps, hiddenItems, now: deps.now ?? (() => new Date()) }),
  );

  app.notFound((c) => apiError(c, 'not_found', 'Route inconnue'));
  app.onError((err, c) => {
    log('error', 'Erreur non gérée', { error: err.message, path: c.req.path });
    deps.reportError?.(err);
    return apiError(c, 'internal_error', 'Erreur interne');
  });

  return app;
}
