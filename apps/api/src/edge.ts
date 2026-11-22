/**
 * Point d'entrée « Supabase Edge Functions » (aperçu et recette).
 *
 * Même application Hono que `server.ts`, servie par le runtime Deno de Supabase sous
 * https://<projet>.supabase.co/functions/v1/api/… . Supabase fournit la connexion à la base
 * (SUPABASE_DB_URL) et la clé de service ; aucun secret n'est saisi à la main pour l'aperçu.
 *
 * Différences avec le serveur Node (production, ADR 0001) :
 * - pas de tâches de fond : l'expiration des commandes non payées est faite à la volée,
 *   l'envoi à la caisse reste immédiat après paiement ;
 * - le paiement Stripe est désactivé tant que les clés ne sont pas posées en secrets de fonction.
 */
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
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { createSupabaseVerifier } from './admin/auth';
import { createApp } from './app';
import { createBanGeoProvider } from './geo';
import { jsonLog } from './http/logging';
import { createNotificationSender } from './notifications/sender';
import { createStripeGateway } from './payments/gateway';
import { expireUnpaidOrders } from './payments/service';
import { createDemoPosGateway } from './pos/gateway';

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
// Pooler en mode transaction : quelques connexions par instance suffisent.
const sql = createSql(required('SUPABASE_DB_URL'), { max: 3 });

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

const payments = createPostgresPaymentStore(sql);
const log = (m: string, d?: Record<string, unknown>) => jsonLog('warn', m, d);

const app = createApp({
  tenants: createPostgresTenantStore(sql),
  restaurants: createPostgresRestaurantStore(sql),
  menus: createMenuCache(createDemoMenuProvider(), { ttlMs: 180_000, maxStaleMs: 3_600_000 }),
  ordering: createPostgresOrderingStore(sql),
  orders: createPostgresOrderReader(sql),
  payments,
  operations: createPostgresOperationsStore(sql),
  pos: createDemoPosGateway((m) => jsonLog('info', m)),
  notifier: createNotificationSender({ expoAccessToken: env('EXPO_ACCESS_TOKEN'), log }),
  admin: createPostgresAdminStore(sql),
  verifier: createSupabaseVerifier({
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    issuer: `${supabaseUrl}/auth/v1`,
  }),
  gateway,
  tokenSecret,
  geo: createBanGeoProvider(env('GEOCODER_URL') ?? 'https://data.geopf.fr/geocodage/search'),
  adminUrl: env('ADMIN_URL') ?? 'http://localhost:3000',
  corsOrigins: '*',
  log: true,
  trustProxy: true,
  ready: () =>
    sql`select 1`.then(
      () => true,
      () => false,
    ),
});

// Pas de tâche de fond : les commandes non payées depuis 15 min sont annulées au fil des requêtes.
let lastExpiry = 0;
const root = new Hono();
root.use('*', async (_c, next) => {
  const now = Date.now();
  if (now - lastExpiry > 60_000) {
    lastExpiry = now;
    void expireUnpaidOrders({ payments, gateway, log }, new Date()).catch(() => undefined);
  }
  await next();
});
root.route('/api', app);

Deno.serve(root.fetch);
