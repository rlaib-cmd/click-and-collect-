import { createDemoLoyaltyProvider } from '@splash360/api-loyalty';
/**
 * Point d'entrée « Supabase Edge Functions » (aperçu et recette).
 *
 * Même application Hono que `server.ts`, servie par le runtime Deno de Supabase sous
 * https://<projet>.supabase.co/functions/v1/api/… . Supabase fournit la connexion à la base
 * (SUPABASE_DB_URL) et la clé de service ; aucun secret n'est saisi à la main pour l'aperçu.
 *
 * Différences avec le serveur Node (production, ADR 0001) :
 * - pas de tâches de fond : l'expiration des commandes non payées et la suite des envois en
 *   caisse (attente de confirmation, nouveaux essais) sont faites au fil des requêtes ;
 * - le paiement Stripe est désactivé tant que les clés ne sont pas posées en secrets de fonction.
 */
import {
  createDemoMenuProvider,
  createMenuCache,
  createRoutingMenuProvider,
  createSplash360Client,
  createSplash360MenuProvider,
  splash360CredentialsFrom,
} from '@splash360/api-menu';
import {
  createPostgresAdminStore,
  createPostgresPromoStore,
  createPostgresDemoLoyaltyStore,
  createPostgresOperationsStore,
  createPostgresOrderingStore,
  createPostgresOrderReader,
  createPostgresPaymentStore,
  createPostgresPosTicketStore,
  createPostgresRestaurantStore,
  createPostgresTenantStore,
  createSql,
  createPostgresOtpStore,
} from '@splash360/db';
import { Hono } from 'hono';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createSupabaseVerifier } from './admin/auth';
import { createSupabaseAssetStorage } from './admin/logo';
import { createSupabaseInviter } from './admin/invite';
import { createApp } from './app';
import { createBanGeoProvider } from './geo';
import { jsonLog } from './http/logging';
import { createOtpDeps, createSmsSender } from './loyalty/otp';
import { createNotificationSender } from './notifications/sender';
import { createStripeGateway } from './payments/gateway';
import { expireUnpaidOrders } from './payments/service';
import { createDemoPosGateway, createRoutingPosGateway } from './pos/gateway';
import { createSplash360PosGateway, splash360Probe } from './pos/splash360';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const env = (name: string) => Deno.env.get(name);
const required = (name: string) => {
  const v = env(name);
  if (!v) throw new Error(`Variable manquante : ${name}`);
  return v;
};

const supabaseUrl = required('SUPABASE_URL');
const databaseUrl = required('SUPABASE_DB_URL');

// Clé de dérivation des jetons de suivi : propre au projet, dérivée de la clé de service
// (jamais exposée), sauf si ORDER_TOKEN_SECRET est fourni explicitement.
const tokenSecret =
  env('ORDER_TOKEN_SECRET') ??
  createHmac('sha256', required('SUPABASE_SERVICE_ROLE_KEY'))
    .update('splash360:order-token')
    .digest('base64url');

const stripeSecret = env('STRIPE_SECRET_KEY');
const stripePublishable = env('STRIPE_PUBLISHABLE_KEY');
const stripeWebhook = env('STRIPE_WEBHOOK_SECRET');
const gateway =
  stripeSecret && stripePublishable && stripeWebhook
    ? createStripeGateway({
        secretKey: stripeSecret,
        publishableKey: stripePublishable,
        webhookSecret: stripeWebhook,
      })
    : null;

const log = (m: string, d?: Record<string, unknown>) => jsonLog('warn', m, d);
// Partagés entre les générations de connexions : cache de carte et clés publiques Supabase Auth.
// Splash360 (ADR 0018) : identifiants en secrets de fonction ; sans eux, démonstration.
const splash360 = splash360CredentialsFrom(env);
const splash360Client = splash360 ? createSplash360Client(splash360) : null;
const menus = createMenuCache(
  createRoutingMenuProvider({
    demo: createDemoMenuProvider(),
    live:
      splash360Client && splash360
        ? createSplash360MenuProvider(splash360Client, splash360.baseUrl)
        : null,
  }),
  { ttlMs: 180_000, maxStaleMs: 3_600_000 },
);
const verifier = createSupabaseVerifier({
  jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
  issuer: `${supabaseUrl}/auth/v1`,
});
const brevoKey = env('BREVO_API_KEY'),
  sender = env('EMAIL_SENDER');
const notifier = createNotificationSender({
  expoAccessToken: env('EXPO_ACCESS_TOKEN'),
  brevo:
    brevoKey && sender
      ? {
          apiKey: brevoKey,
          senderEmail: sender,
          senderName: env('EMAIL_SENDER_NAME') ?? 'Commande en ligne',
        }
      : undefined,
  log,
});
const pos = createRoutingPosGateway({
  demo: createDemoPosGateway({ log: (m) => jsonLog('info', m) }),
  live: splash360Client
    ? createSplash360PosGateway(splash360Client, {
        feeVatRate: Number(env('SPLASH360_FEE_VAT_RATE') ?? '0.2'),
      })
    : null,
});
const seconds = (name: string, fallback: number) => {
  const v = Number(env(name));
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback * 1000;
};
const posTiming = {
  readyTimeoutMs: seconds('POS_READY_TIMEOUT_SECONDS', 60),
  confirmTimeoutMs: seconds('POS_CONFIRM_TIMEOUT_SECONDS', 300),
};
const geo = createBanGeoProvider(env('GEOCODER_URL') ?? 'https://data.geopf.fr/geocodage/search');

const adminUrl = env('ADMIN_URL') ?? 'http://localhost:3000';
// Invitations du back-office : Supabase Auth du même projet, clé de service fournie par le runtime.
const inviter = createSupabaseInviter({
  url: supabaseUrl,
  serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  redirectTo: `${adminUrl.replace(/\/+$/, '')}/mot-de-passe/`,
  log,
});

// Connexion du client par code (lot 10) : SMS Brevo, sinon journalisé ; recette = aide au test.
const sms = createSmsSender({ brevoApiKey: brevoKey, log });
const appEnv = env('APP_ENV') ?? 'recette';

function build() {
  const sql = createSql(databaseUrl, { max: 3, idleTimeout: 10 });
  const payments = createPostgresPaymentStore(sql);
  const app = createApp({
    tenants: createPostgresTenantStore(sql),
    restaurants: createPostgresRestaurantStore(sql),
    menus,
    ordering: createPostgresOrderingStore(sql),
    orders: createPostgresOrderReader(sql),
    payments,
    operations: createPostgresOperationsStore(sql),
    pos,
    tickets: createPostgresPosTicketStore(sql),
    splash360:
      splash360Client && splash360 ? splash360Probe(splash360Client, splash360.baseUrl) : null,
    posTiming,
    // Le webhook Stripe attend la réponse : attente courte, la suite se fait au fil des requêtes.
    posInlineWaitMs: 5000,
    notifier,
    admin: createPostgresAdminStore(sql),
    promos: createPostgresPromoStore(sql),
    verifier,
    gateway,
    tokenSecret,
    // Aperçu : fidélité de test, connexion par e-mail (ADR 0009).
    loyalty: createDemoLoyaltyProvider(createPostgresDemoLoyaltyStore(sql), randomUUID),
    loyaltyDemoLogin: env('LOYALTY_DEMO_LOGIN') !== '0' && appEnv !== 'production',
    ...(env('LOYALTY_OTP') === '1'
      ? {
          otp: createOtpDeps({
            store: createPostgresOtpStore(sql),
            sms,
            notifier,
            emailConfigured: Boolean(brevoKey && sender),
            baseSecret: tokenSecret,
            debugEcho: env('OTP_DEBUG_ECHO') === '1',
            environment: appEnv,
            randomBytes: (n) => randomBytes(n),
            log,
          }),
        }
      : {}),
    geo,
    adminUrl,
    inviter,
    // Logos du studio design (lot 12) : Supabase Storage du même projet, clé de service.
    assets: createSupabaseAssetStorage({
      url: supabaseUrl,
      serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    }),
    corsOrigins: '*',
    log: true,
    trustProxy: true,
    ready: () =>
      sql`select 1`.then(
        () => true,
        () => false,
      ),
  });
  return { sql, payments, app };
}

/*
 * Le runtime gèle les instances entre deux rafales de requêtes : les sockets Postgres
 * meurent sans que les minuteries de postgres.js ne tournent. Après un silence, on repart
 * donc d'un pool neuf ; l'ancien est fermé une fois ses requêtes en cours terminées.
 */
const IDLE_RESET_MS = 3_000;
let current = build();
let lastActivity = Date.now();
let inFlight = 0;
// Pas de tâche de fond : les commandes non payées depuis 15 min sont annulées au fil des requêtes,
// et les envois en caisse en attente (confirmation, nouveaux essais) avancent de la même façon.
let lastExpiry = 0;
let lastDispatch = 0;

const root = new Hono();
root.use('*', async (_c, next) => {
  const now = Date.now();
  if (inFlight === 0 && now - lastActivity > IDLE_RESET_MS) {
    const old = current.sql;
    current = build();
    void old.end({ timeout: 5 }).catch(() => undefined);
  }
  if (now - lastExpiry > 60_000) {
    lastExpiry = now;
    void expireUnpaidOrders({ payments: current.payments, gateway, log }, new Date()).catch(
      () => undefined,
    );
  }
  if (now - lastDispatch > 10_000) {
    lastDispatch = now;
    void current.app.runDispatches().catch(() => undefined);
  }
  inFlight += 1;
  try {
    await next();
  } finally {
    inFlight -= 1;
    lastActivity = Date.now();
  }
});
root.all('/api/*', (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice('/api'.length);
  return current.app.fetch(new Request(url, c.req.raw));
});

Deno.serve(root.fetch);
