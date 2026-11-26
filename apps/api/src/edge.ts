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
  createPostgresAmbassadorStore,
  createPostgresPosSalesStore,
  createPostgresPromoStore,
  createPostgresDemoLoyaltyStore,
  createPostgresOperationsStore,
  createPostgresOrderingStore,
  createPostgresOrderReader,
  createPostgresPaymentStore,
  createPostgresStripeCustomerStore,
  createPostgresPosTicketStore,
  createPostgresRestaurantStore,
  createPostgresTenantStore,
  createPostgresYoufidStore,
  createSql,
  createPostgresSplash360Gate,
  type Sql,
  createPostgresOtpStore,
  createPostgresMemberSessionStore,
  createPostgresProximityStore,
} from '@splash360/db';
import { Hono } from 'hono';
import { corsOriginsFrom } from './http/cors';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createSupabaseVerifier } from './admin/auth';
import { createSupabaseAssetStorage } from './admin/logo';
import { createSupabaseInviter } from './admin/invite';
import { createApp } from './app';
import { createBanGeoProvider } from './geo';
import { jsonLog } from './http/logging';
import { createOtpDeps, createSmsSender } from './loyalty/otp';
import { configureLoyalty } from './loyalty/youfid';
import { createClaudePhotoAnalyzer } from './loyalty/photo-check';
import { createClaudeTicketReader } from './loyalty/ticket-read';
import { createNotificationSender } from './notifications/sender';
import { createStripeCardGateway } from './payments/cards';
import { createStripeGateway } from './payments/gateway';
import { expireUnpaidOrders } from './payments/service';
import { createDemoPosGateway, createRoutingPosGateway } from './pos/gateway';
import { createSplash360PosGateway, splash360Probe, splash360SalesSource } from './pos/splash360';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const env = (name: string) => Deno.env.get(name);
const anthropicKey = env('ANTHROPIC_API_KEY');
const required = (name: string) => {
  const v = env(name);
  if (!v) throw new Error(`Variable manquante : ${name}`);
  return v;
};

const supabaseUrl = required('SUPABASE_URL');
// Pooler Supabase (Supavisor, mode transaction, port 6543) de préférence : SUPABASE_DB_URL est la
// connexion directe, limitée à 60 connexions sur la petite instance et saturée dès que beaucoup de
// copies de la fonction tournent en même temps (constaté en recette le 24/11).
/**
 * Adresse du pooler construite à partir de SUPABASE_DB_URL (fournie et tenue à jour par Supabase,
 * y compris après une réinitialisation du mot de passe) et de l'hôte du pooler (DATABASE_POOLER_HOST,
 * non secret) : aucun mot de passe à recopier à la main.
 */
function derivedPoolerUrl(): string | undefined {
  const host = env('DATABASE_POOLER_HOST');
  if (!host) return undefined;
  try {
    const direct = new URL(required('SUPABASE_DB_URL'));
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    const url = new URL(`postgresql://${host}:6543/postgres`);
    url.username = `postgres.${ref}`;
    url.password = direct.password;
    return url.toString();
  } catch {
    return undefined;
  }
}
const poolerSource = env('DATABASE_POOLER_HOST')
  ? 'pooler (construit)'
  : env('DATABASE_POOLER_URL')
    ? 'pooler'
    : 'directe';
const databaseUrl = derivedPoolerUrl() ?? env('DATABASE_POOLER_URL') ?? required('SUPABASE_DB_URL');
// Diagnostic sans secret : type de connexion, hôte, port et utilisateur (jamais le mot de passe).
try {
  const u = new URL(databaseUrl);
  jsonLog('info', 'Connexion base', {
    via: poolerSource,
    host: u.hostname,
    port: u.port,
    user: decodeURIComponent(u.username),
    passwordLength: decodeURIComponent(u.password).length,
  });
} catch {
  jsonLog('error', 'Adresse de base illisible', { via: poolerSource });
}

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
        paymentDomains: (env('STRIPE_PAYMENT_DOMAINS') ?? '')
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
      })
    : null;
// Cartes enregistrées (lot 18, ADR 0023) : seulement si le paiement en ligne est configuré.
const cardGateway =
  gateway && stripeSecret && stripePublishable
    ? createStripeCardGateway({ secretKey: stripeSecret, publishableKey: stripePublishable })
    : undefined;

const log = (m: string, d?: Record<string, unknown>) => jsonLog('warn', m, d);
// Partagés entre les générations de connexions : cache de carte et clés publiques Supabase Auth.
// Splash360 (ADR 0018) : identifiants en secrets de fonction ; sans eux, démonstration.
const splash360 = splash360CredentialsFrom(env);
// Appels séquentiels par identifiant client, aussi entre copies de la fonction (ADR 0024) :
// verrou consultatif Postgres sur la connexion de la génération en cours.
let gateSql: Sql | null = null;
const splash360Gate = createPostgresSplash360Gate(() => {
  if (!gateSql) throw new Error('Connexion Postgres pas encore ouverte');
  return gateSql;
});
const splash360Client = splash360
  ? createSplash360Client({
      ...splash360,
      gate: splash360Gate,
      onNotice: (m, d) => jsonLog('warn', m, d),
    })
  : null;
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
  confirmTimeoutMs: seconds('POS_CONFIRM_TIMEOUT_SECONDS', 60),
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
// Sans APP_ENV explicite, on se comporte comme en production (aucun raccourci de test, audit du 25/11).
const appEnv = env('APP_ENV') ?? 'production';

function build() {
  // 2 connexions par copie de la fonction : la base directe n'en accepte que 60 au total.
  const sql = createSql(databaseUrl, { max: 2, idleTimeout: 10 });
  gateSql = sql;
  const payments = createPostgresPaymentStore(sql);
  const tenants = createPostgresTenantStore(sql);
  // Fidélité (lot 21, ADR 0026) : YouFID pour les enseignes de YOUFID_ACCOUNTS (secret de
  // fonction), fidélité de test pour les autres.
  const youfidStore = createPostgresYoufidStore(sql);
  const { loyalty, youfid } = configureLoyalty({
    // Production : jamais la fidélité de démonstration (points fictifs hors YouFID) ; sans compte
    // YouFID, l'enseigne n'a simplement pas de club.
    fallback:
      appEnv === 'production'
        ? null
        : createDemoLoyaltyProvider(createPostgresDemoLoyaltyStore(sql), randomUUID),
    accountsJson: env('YOUFID_ACCOUNTS'),
    baseUrl: env('YOUFID_BASE_URL'),
    deviceId: env('YOUFID_DEVICE_ID'),
    environment: appEnv,
    store: youfidStore,
    tenants,
    random: randomUUID,
    log,
  });
  const app = createApp({
    tenants,
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
    ambassador: createPostgresAmbassadorStore(sql),
    // Achat vérifié (lot 20) : copie des ventes et export Splash360 (sans identifiants : à vérifier).
    posSales: createPostgresPosSalesStore(sql),
    salesSource: splash360Client ? splash360SalesSource(splash360Client) : null,
    // Sans clé : la photo est « à vérifier » par l'équipe (aucune clé dans le dépôt).
    ...(anthropicKey
      ? {
          photoAnalyzer: createClaudePhotoAnalyzer({
            apiKey: anthropicKey,
            ...(env('AMBASSADOR_PHOTO_MODEL') ? { model: env('AMBASSADOR_PHOTO_MODEL') } : {}),
            log,
          }),
          // Achat vérifié (lot 20) : même clé et même modèle que l'analyse de la photo.
          ticketReader: createClaudeTicketReader({
            apiKey: anthropicKey,
            ...(env('AMBASSADOR_PHOTO_MODEL') ? { model: env('AMBASSADOR_PHOTO_MODEL') } : {}),
            log,
          }),
        }
      : {}),
    verifier,
    gateway,
    cardGateway,
    stripeCustomers: createPostgresStripeCustomerStore(sql),
    clientAppUrl: env('CLIENT_APP_URL'),
    tokenSecret,
    // Aperçu : YouFID pour les enseignes configurées, fidélité de test sinon (ADR 0009, 0026).
    ...(loyalty ? { loyalty } : {}),
    loyaltyLedger: youfidStore,
    youfid,
    memberSessions: createPostgresMemberSessionStore(sql),
    proximity: createPostgresProximityStore(sql),
    // Connexion de démonstration sans code : seulement si demandée explicitement, hors production
    // (désactivée par défaut, audit du 25/11).
    loyaltyDemoLogin: env('LOYALTY_DEMO_LOGIN') === '1' && appEnv !== 'production',
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
            ...(env('OTP_TENANT_HOURLY_LIMIT')
              ? { tenantHourlyLimit: Number(env('OTP_TENANT_HOURLY_LIMIT')) }
              : {}),
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
    // Origines web autorisées (CORS_ORIGINS, séparées par des virgules) ; `*` si absent (recette).
    corsOrigins: corsOriginsFrom(env('CORS_ORIGINS')),
    log: true,
    trustProxy: true,
    // Posé par Cloudflare devant Supabase Edge, qui écrase toute valeur envoyée par le client.
    clientIpHeader: 'cf-connecting-ip',
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
const viaPooler = poolerSource !== 'directe';
let current = build();
let lastActivity = Date.now();
let inFlight = 0;
// Pas de tâche de fond : les commandes non payées depuis 15 min sont annulées au fil des requêtes,
// et les envois en caisse en attente (confirmation, nouveaux essais) avancent de la même façon.
let lastExpiry = 0;
let lastDispatch = 0;
let lastAmbassador = 0;
let lastProximityPurge = 0;

/**
 * Tâche de fond (envois en caisse, expirations) : comptée comme une requête en cours, pour que les
 * connexions à la base ne soient pas renouvelées sous elle, et confiée à `EdgeRuntime.waitUntil`
 * pour que Supabase ne coupe pas l'instance avant la fin (sinon : ticket déposé chez Splash360
 * mais non enregistré chez nous, puis déposé une seconde fois).
 */
function background(name: string, task: Promise<unknown>) {
  inFlight += 1;
  const done = task
    .catch((error: unknown) =>
      jsonLog('error', 'Tâche de fond en échec', {
        task: name,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => {
      inFlight -= 1;
      lastActivity = Date.now();
    });
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(
    done,
  );
}

const root = new Hono();
root.use('*', async (c, next) => {
  const now = Date.now();
  // Les tâches de fond (envoi en caisse, expirations) ne partent que du trafic client : une
  // requête du back-office, même en boucle, ne doit pas déclencher de travail sur la base.
  const clientTraffic =
    c.req.method !== 'OPTIONS' && !new URL(c.req.url).pathname.includes('/v1/admin/');
  // Par le pooler (Supavisor), les connexions sont gérées côté Supabase : pas de pool neuf après
  // chaque silence (chacun relisait le catalogue des types, 753 fois pendant le test de charge).
  if (!viaPooler && inFlight === 0 && now - lastActivity > IDLE_RESET_MS) {
    const old = current.sql;
    current = build();
    void old.end({ timeout: 5 }).catch(() => undefined);
  }
  if (clientTraffic && now - lastExpiry > 60_000) {
    lastExpiry = now;
    background(
      'expiration',
      expireUnpaidOrders({ payments: current.payments, gateway, log }, new Date()),
    );
  }
  if (clientTraffic && now - lastDispatch > 10_000) {
    lastDispatch = now;
    background('caisse', current.app.runDispatches());
  }
  // Ambassadeur (lot 17) : contrôles et crédits échus, au plus une fois par minute.
  if (clientTraffic && now - lastAmbassador > 60_000) {
    lastAmbassador = now;
    background('ambassadeur', current.app.runAmbassador());
  }
  // Bons plans à proximité (lot 22) : purge des événements de plus de 90 jours, une fois par heure.
  if (clientTraffic && now - lastProximityPurge > 3_600_000) {
    lastProximityPurge = now;
    background('proximité', current.app.runProximityPurge());
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
