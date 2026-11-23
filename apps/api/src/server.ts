import { createDemoLoyaltyProvider } from '@splash360/api-loyalty';
import { randomBytes, randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import * as Sentry from '@sentry/node';
import { createDemoMenuProvider, createMenuCache } from '@splash360/api-menu';
import {
  createPostgresAdminStore,
  createPostgresPromoStore,
  createPostgresDemoLoyaltyStore,
  createPostgresOperationsStore,
  createPostgresOrderingStore,
  createPostgresOrderReader,
  createPostgresPaymentStore,
  createPostgresRestaurantStore,
  createPostgresTenantStore,
  createSql,
  createPostgresOtpStore,
} from '@splash360/db';
import { createSupabaseVerifier } from './admin/auth';
import { createSupabaseInviter } from './admin/invite';
import { createApp } from './app';
import { loadEnv } from './env';
import { jsonLog } from './http/logging';
import { createOtpDeps, createSmsSender } from './loyalty/otp';
import { createBanGeoProvider, createDemoGeoProvider } from './geo';
import { createNotificationSender } from './notifications/sender';
import { createStripeGateway } from './payments/gateway';
import { processDispatches } from './pos/dispatcher';
import { createDemoPosGateway } from './pos/gateway';
import { expireUnpaidOrders } from './payments/service';

const env = loadEnv();
if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT });
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
if (!gateway) jsonLog('warn', 'Clés Stripe absentes : paiement en ligne désactivé');

const payments = createPostgresPaymentStore(sql);
const operations = createPostgresOperationsStore(sql);
const orders = createPostgresOrderReader(sql);
const restaurants = createPostgresRestaurantStore(sql);
const log = (m: string, d?: Record<string, unknown>) => jsonLog('warn', m, d);
// En attendant la documentation de la caisse Splash360 : caisse de démonstration.
const pos = createDemoPosGateway((m) => jsonLog('info', m));

const notifier = createNotificationSender({
  expoAccessToken: env.EXPO_ACCESS_TOKEN,
  brevo:
    env.BREVO_API_KEY && env.EMAIL_SENDER
      ? {
          apiKey: env.BREVO_API_KEY,
          senderEmail: env.EMAIL_SENDER,
          senderName: env.EMAIL_SENDER_NAME,
        }
      : undefined,
  log,
});

const app = createApp({
  tenants: createPostgresTenantStore(sql),
  restaurants,
  menus,
  ordering: createPostgresOrderingStore(sql),
  orders,
  payments,
  operations,
  pos,
  notifier,
  posWebhookSecret: env.POS_WEBHOOK_SECRET ?? null,
  admin: createPostgresAdminStore(sql),
  promos: createPostgresPromoStore(sql),
  verifier: createSupabaseVerifier({
    jwksUrl: env.SUPABASE_JWKS_URL,
    secret: env.SUPABASE_JWT_SECRET,
    issuer: env.SUPABASE_JWT_ISSUER,
  }),
  adminUrl: env.ADMIN_URL,
  inviter:
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseInviter({
          url: env.SUPABASE_URL,
          serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
          redirectTo: `${env.ADMIN_URL.replace(/\/+$/, '')}/mot-de-passe/`,
          log,
        })
      : null,
  gateway,
  tokenSecret: env.ORDER_TOKEN_SECRET,
  ...(env.LOYALTY === 'demo'
    ? {
        loyalty: createDemoLoyaltyProvider(createPostgresDemoLoyaltyStore(sql), randomUUID),
        loyaltyDemoLogin: env.LOYALTY_DEMO_LOGIN === '1' && env.APP_ENV !== 'production',
        ...(env.LOYALTY_OTP === '1'
          ? {
              otp: createOtpDeps({
                store: createPostgresOtpStore(sql),
                sms: createSmsSender({ brevoApiKey: env.BREVO_API_KEY, log }),
                notifier,
                emailConfigured: Boolean(env.BREVO_API_KEY && env.EMAIL_SENDER),
                baseSecret: env.ORDER_TOKEN_SECRET,
                debugEcho: env.OTP_DEBUG_ECHO === '1',
                environment: env.APP_ENV,
                randomBytes: (n) => randomBytes(n),
                log,
              }),
            }
          : {}),
      }
    : {}),
  geo:
    env.GEOCODER_URL === 'demo' ? createDemoGeoProvider() : createBanGeoProvider(env.GEOCODER_URL),
  corsOrigins: origins,
  log: true,
  trustProxy: env.TRUST_PROXY === '1',
  ready: () =>
    sql`select 1`.then(
      () => true,
      () => false,
    ),
  ...(env.SENTRY_DSN ? { reportError: (error: Error) => Sentry.captureException(error) } : {}),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  jsonLog('info', 'API Splash360 Commande démarrée', { port: info.port });
});

// Commandes non payées après 15 min : annulées, créneau libéré. Sûr avec plusieurs instances
// (une seule mise à jour atomique par commande).
const expiry = setInterval(() => {
  expireUnpaidOrders({ payments, gateway, log }, new Date())
    .then((n) => {
      if (n > 0) jsonLog('info', 'Commandes non payées annulées', { count: n });
    })
    .catch((error: unknown) =>
      jsonLog('error', 'Expiration des commandes en échec', { error: String(error) }),
    );
}, 60_000);

// Envois à la caisse en attente (nouveaux essais après échec).
const dispatcher = setInterval(() => {
  processDispatches({ operations, orders, restaurants, pos, log }).catch((error: unknown) =>
    jsonLog('error', 'Envoi à la caisse en échec', { error: String(error) }),
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
