import { serve } from '@hono/node-server';
import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import {
  createPostgresAdminStore,
  createPostgresOperationsStore,
  createPostgresOrderingStore,
  createPostgresOrderReader,
  createPostgresPaymentStore,
  createPostgresRestaurantStore,
  createPostgresTenantStore,
  createSql,
} from '@splash360/db';
import { createSupabaseVerifier } from './admin/auth';
import { createApp } from './app';
import { loadEnv } from './env';
import { createBanGeoProvider, createDemoGeoProvider } from './geo';
import { createNotificationSender } from './notifications/sender';
import { createStripeGateway } from './payments/gateway';
import { processDispatches } from './pos/dispatcher';
import { createDemoPosGateway } from './pos/gateway';
import { expireUnpaidOrders } from './payments/service';

const env = loadEnv();
const sql = createSql(env.DATABASE_URL);
const origins = env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((o) => o.trim());

// En attendant la documentation de l'API menu Splash360 : cartes de démonstration.
const menus = createMenuCache(createDemoMenuProvider(), {
  ttlMs: env.MENU_CACHE_TTL_SECONDS * 1000,
  maxStaleMs: env.MENU_MAX_STALE_MINUTES * 60_000,
});

const gateway =
  env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_WEBHOOK_SECRET
    ? createStripeGateway({
        secretKey: env.STRIPE_SECRET_KEY,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      })
    : null;
if (!gateway) console.warn('Clés Stripe absentes : paiement en ligne désactivé.');

const payments = createPostgresPaymentStore(sql);
const operations = createPostgresOperationsStore(sql);
const orders = createPostgresOrderReader(sql);
const restaurants = createPostgresRestaurantStore(sql);
const log = (m: string, d?: Record<string, unknown>) => console.warn(m, d);
// En attendant la documentation de la caisse Splash360 : caisse de démonstration.
const pos = createDemoPosGateway((m) => console.log(m));

const app = createApp({
  tenants: createPostgresTenantStore(sql),
  restaurants,
  menus,
  ordering: createPostgresOrderingStore(sql),
  orders,
  payments,
  operations,
  pos,
  notifier: createNotificationSender({ expoAccessToken: env.EXPO_ACCESS_TOKEN, log }),
  posWebhookSecret: env.POS_WEBHOOK_SECRET ?? null,
  admin: createPostgresAdminStore(sql),
  verifier: createSupabaseVerifier({
    jwksUrl: env.SUPABASE_JWKS_URL,
    secret: env.SUPABASE_JWT_SECRET,
    issuer: env.SUPABASE_JWT_ISSUER,
  }),
  adminUrl: env.ADMIN_URL,
  gateway,
  tokenSecret: env.ORDER_TOKEN_SECRET,
  geo:
    env.GEOCODER_URL === 'demo' ? createDemoGeoProvider() : createBanGeoProvider(env.GEOCODER_URL),
  corsOrigins: origins,
  log: true,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API Splash360 Commande à l'écoute sur http://localhost:${info.port}`);
});

// Commandes non payées après 15 min : annulées, créneau libéré. Sûr avec plusieurs instances
// (une seule mise à jour atomique par commande).
const expiry = setInterval(() => {
  expireUnpaidOrders({ payments, gateway, log: (m, d) => console.warn(m, d) }, new Date())
    .then((n) => {
      if (n > 0) console.log(`${n} commande(s) non payée(s) annulée(s)`);
    })
    .catch((error: unknown) => console.error('Expiration des commandes en échec', error));
}, 60_000);

// Envois à la caisse en attente (nouveaux essais après échec).
const dispatcher = setInterval(() => {
  processDispatches({ operations, orders, restaurants, pos, log }).catch((error: unknown) =>
    console.error('Envoi à la caisse en échec', error),
  );
}, 15_000);

function shutdown() {
  clearInterval(expiry);
  clearInterval(dispatcher);
  server.close();
  void sql.end({ timeout: 5 }).then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
