import type { MemberSessionStore, PosSalesStore, StripeCustomerStore } from '@splash360/db';
import type { LoyaltyProvider } from '@splash360/api-loyalty';
import type { AuthInviter } from './admin/invite';
import type { MenuCache } from '@splash360/api-menu';
import type {
  AdminStore,
  AmbassadorStore,
  PromoAdminStore,
  OperationsStore,
  OrderingStore,
  OrderReader,
  PaymentStore,
  PosTicketStore,
  RestaurantStore,
  TenantStore,
} from '@splash360/db';
import type { NotificationSender } from './notifications/sender';
import { notifyStatus, tenantNameResolver } from './notifications/service';
import type { CardGateway } from './payments/cards';
import type { PaymentGateway } from './payments/gateway';
import { withRewardCategories } from './loyalty/reward-settings';
import { processDispatches } from './pos/dispatcher';
import type { PosGateway } from './pos/gateway';
import type { PosTiming } from './pos/handshake';
import { posRoutes } from './routes/pos';
import type { TokenVerifier } from './admin/auth';
import { adminRoutes, type Splash360Probe } from './routes/admin';
import { MAX_LOGO_BYTES, type AssetStorage } from './admin/logo';
import type { GeoProvider } from './geo';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { apiError } from './errors';
import { jsonLog, requestLogger, type Log } from './http/logging';
import { rateLimit } from './http/rate-limit';
import type { OtpDeps } from './loyalty/otp';
import { settleLoyalty } from './loyalty/settle';
import { processAmbassadorEntries, type StoryChecker } from './loyalty/ambassador';
import type { PhotoAnalyzer } from './loyalty/photo-check';
import type { TicketReader } from './loyalty/ticket-read';
import {
  verifyAmbassadorTickets,
  type SalesSource,
  type TicketCheckRun,
} from './loyalty/ticket-check';
import { MAX_PHOTO_BYTES } from '@splash360/contracts';
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
  /** Poignée de main avec la caisse, suivie sur la commande (ADR 0018). */
  readonly tickets: PosTicketStore;
  readonly posTiming?: Partial<PosTiming>;
  /** Attente sur place de la caisse dans l'envoi (défaut 8 s ; 0 en test). */
  readonly posInlineWaitMs?: number;
  readonly notifier: NotificationSender;
  readonly admin: AdminStore;
  /** Codes promo gérés au back-office (lot 11). */
  readonly promos?: PromoAdminStore | undefined;
  /** Vérification des jetons de session du back-office (Supabase Auth). */
  readonly verifier: TokenVerifier;
  /** URL publique du back-office. */
  readonly adminUrl?: string;
  /** Invitations des comptes du back-office (Supabase Auth) ; absent = aucun e-mail. */
  readonly inviter?: AuthInviter | null;
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
  readonly rateLimits?: { orders: number; reads: number; admin?: number; photos?: number };
  /** Attente imposée à un back-office obsolète avant de lui répondre (défaut 60 s). */
  readonly outdatedClientHoldMs?: number;
  readonly trustProxy?: boolean;
  /** En-tête d'adresse client posé par l'hébergeur (voir `RateLimitOptions.ipHeader`). */
  readonly clientIpHeader?: string;
  /** Club fidélité Splash360 (lot 8) ; absent = pas de fidélité. */
  readonly loyalty?: LoyaltyProvider;
  /** Version de session des membres du club (audit M4). */
  readonly memberSessions?: MemberSessionStore;
  /** Ambassadeur (lot 15, ADR 0019) ; absent = fonction désactivée. */
  readonly ambassador?: AmbassadorStore;
  /** Analyse de la photo ambassadeur (lot 17) ; absente = vérification manuelle par l'équipe. */
  readonly photoAnalyzer?: PhotoAnalyzer;
  /** Lecture du ticket photographié (lot 20) ; absente = le client tape le numéro. */
  readonly ticketReader?: TicketReader;
  /** Copie des ventes Splash360 pour l'« achat vérifié » (lot 20) ; absente = non vérifié. */
  readonly posSales?: PosSalesStore;
  /** Export des ventes Splash360 (lot 20) ; null = identifiants absents, tickets « à vérifier ». */
  readonly salesSource?: SalesSource | null;
  /** Contrôle « story toujours en ligne » (lot 17) ; absent = réputée en ligne (en attendant Meta). */
  readonly storyChecker?: StoryChecker;
  /** Connexion au club par simple e-mail : données de test uniquement (ADR 0009). */
  readonly loyaltyDemoLogin?: boolean;
  /** Connexion du client par code SMS ou e-mail (lot 10) ; absent = désactivée. */
  readonly otp?: OtpDeps;
  /** Stockage des logos téléversés au back-office (lot 12) ; absent = URL seulement. */
  readonly assets?: AssetStorage | null;
  /** Test de connexion à l'API Splash360 réelle ; absent : identifiants non posés. */
  readonly splash360?: Splash360Probe | null;
  /** Cartes enregistrées des membres (lot 18, ADR 0023) ; absent = fonction désactivée. */
  readonly cardGateway?: CardGateway | undefined;
  readonly stripeCustomers?: StripeCustomerStore | undefined;
  /** Adresse de retour 3-D Secure de l'app web (paiement avec carte enregistrée). */
  readonly clientAppUrl?: string | undefined;
}

/**
 * Serveur de la commande en ligne. Les dépendances sont injectées
 * pour tester les routes sans base (ADR 0003).
 */
export function createApp(input: AppDeps) {
  // Paliers de cadeaux complétés des catégories réglées par l'enseigne (lot 16).
  const deps: AppDeps = input.loyalty
    ? { ...input, loyalty: withRewardCategories(input.loyalty, input.admin) }
    : input;
  const app = new Hono();

  const log = deps.logger ?? jsonLog;
  if (deps.log) app.use(requestLogger(log));
  app.use(secureHeaders());
  // Corps de requête limité (le webhook Stripe et l'export restent largement en dessous).
  // Le logo du studio design (lot 12) a sa propre limite, plus haute (2 Mo, contrôlée par la route).
  const LOGO_PATH = '/v1/admin/theme/logo';
  const smallBodies = bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => apiError(c, 'payload_too_large', 'Requête trop volumineuse'),
  });
  const logoBodies = bodyLimit({
    maxSize: MAX_LOGO_BYTES + 1024,
    onError: (c) => apiError(c, 'payload_too_large', 'Logo trop lourd : 2 Mo maximum'),
  });
  // Photo « Ambassadeur » (lot 17) : 4 Mo d'image, soit environ 5,4 Mo une fois en base64.
  // Photo du ticket de caisse (lot 20) : même limite.
  const PHOTO_PATH = /^\/v1\/tenants\/[^/]+\/ambassador\/(?:photo-check|ticket-photo)$/;
  const photoBodies = bodyLimit({
    maxSize: Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4096,
    onError: (c) => apiError(c, 'payload_too_large', 'Photo trop lourde : 4 Mo maximum'),
  });
  app.use('/v1/*', (c, next) =>
    (c.req.path === LOGO_PATH
      ? logoBodies
      : PHOTO_PATH.test(c.req.path)
        ? photoBodies
        : smallBodies)(c, next),
  );
  const origins = deps.corsOrigins ?? '*';
  app.use(
    '/v1/*',
    cors({
      origin: origins === '*' ? '*' : [...origins],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Tenant-Id',
        'X-Splash360-Client',
        'X-Member-Token',
      ],
      // Préflight gardé 10 min par le navigateur : la moitié des requêtes de la rafale du 24/11
      // étaient des OPTIONS. Retry-After et X-Request-Id lisibles pour la reprise et le diagnostic.
      maxAge: 600,
      exposeHeaders: ['Retry-After', 'X-Request-Id'],
    }),
  );

  const warn = (m: string, d?: Record<string, unknown>) => log('warn', m, d);
  // Liens d'aperçu du brouillon de design (lot 12) : clé dérivée, distincte des jetons de commande.
  const previewSecret = createHmac('sha256', deps.tokenSecret)
    .update('splash360:theme-preview')
    .digest('base64url');

  // Limitation de débit des routes publiques sensibles (par adresse IP).
  // Lectures : 1 200/min par adresse. Les clients d'un même wifi (restaurant, bureau) partagent
  // une adresse, et chacun interroge la caisse chaque seconde avant de payer (ADR 0018) : à
  // 300/min, cinq clients en attente en même temps suffisaient à être bloqués.
  const limits = deps.rateLimits ?? { orders: 20, reads: 1200 };
  const trustProxy = deps.trustProxy ?? false;
  const ipHeader = deps.clientIpHeader;
  const strict = rateLimit({ limit: limits.orders, windowMs: 60_000, trustProxy, ipHeader });
  for (const path of [
    '/v1/tenants/:s/orders',
    '/v1/tenants/:s/orders/:id/payment',
    '/v1/tenants/:s/orders/:id/payment/saved-card',
    '/v1/tenants/:s/loyalty/me/cards/setup',
    '/v1/tenants/:s/restaurants/:r/quote',
    '/v1/tenants/:s/loyalty/join',
    '/v1/tenants/:s/loyalty/login',
    '/v1/tenants/:s/loyalty/otp/start',
    '/v1/tenants/:s/loyalty/otp/verify',
    '/v1/tenants/:s/ambassador/entries',
  ]) {
    app.on('POST', path, strict);
  }
  // Analyse de photo (appel payant à l'IA) : plafond propre, plus bas.
  // Lecture du ticket photographié (lot 20) : même plafond, compté à part.
  for (const path of [
    '/v1/tenants/:s/ambassador/photo-check',
    '/v1/tenants/:s/ambassador/ticket-photo',
  ]) {
    app.on(
      'POST',
      path,
      rateLimit({ limit: limits.photos ?? 6, windowMs: 60_000, trustProxy, ipHeader }),
    );
  }
  app.use(
    '/v1/tenants/*',
    rateLimit({ limit: limits.reads, windowMs: 60_000, trustProxy, ipHeader }),
  );
  // Back-office : plafond par adresse, vérifié en premier, avant toute lecture en base et avant
  // le garde ci-dessous (audit du 25/11, M6). Un onglet qui boucle est arrêté ici.
  app.use(
    '/v1/admin/*',
    rateLimit({ limit: limits.admin ?? 600, windowMs: 60_000, trustProxy, ipHeader }),
  );
  // Back-office obsolète (onglet resté ouvert sur la version qui bouclait, 24/11) : il n'annonce
  // pas sa version. On le fait patienter avant de répondre « rechargez » : l'ancien code ne relance
  // qu'après une réponse, sa boucle ralentit fortement. Au plus `maxHeld` requêtes retenues en même
  // temps par instance ; au-delà, réponse immédiate (pas de saturation volontaire, audit M6).
  const hold = deps.outdatedClientHoldMs ?? 60_000;
  const maxHeld = 20;
  let held = 0;
  app.use('/v1/admin/*', async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.header('X-Splash360-Client') === 'back-office-2')
      return next();
    if (hold > 0 && held < maxHeld) {
      held += 1;
      try {
        await new Promise((r) => setTimeout(r, hold));
      } finally {
        held -= 1;
      }
    }
    return apiError(c, 'client_outdated', 'Version obsolète du back-office : rechargez la page');
  });
  const loyaltyDeps = {
    loyalty: deps.loyalty,
    tenants: deps.tenants,
    orders: deps.orders,
    payments: deps.payments,
    log: warn,
  };
  const notify = {
    operations: deps.operations,
    orders: deps.orders,
    tenantName: tenantNameResolver(deps.tenants),
    notifier: deps.notifier,
    log: warn,
    afterStatus: (tenantId: string, orderId: string, status: string) =>
      settleLoyalty(loyaltyDeps, tenantId, orderId, status),
  };
  const dispatch = {
    operations: deps.operations,
    orders: deps.orders,
    restaurants: deps.restaurants,
    pos: deps.pos,
    tickets: deps.tickets,
    payments: deps.payments,
    gateway: deps.gateway,
    timing: deps.posTiming,
    inlineWaitMs: deps.posInlineWaitMs,
    now: deps.now,
    log: warn,
    // Caisse absente ou refus : le client est prévenu (annulée, remboursé le cas échéant).
    onCompensated: (order: { orderId: string; tenantId: string }) =>
      notifyStatus(notify, order.tenantId, order.orderId, 'cancelled'),
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
      promos: deps.promos,
      tenants: deps.tenants,
      restaurants: deps.restaurants,
      payments: deps.payments,
      gateway: deps.gateway,
      menus: deps.menus,
      loyalty: deps.loyalty,
      ambassador: deps.ambassador,
      adminUrl: deps.adminUrl ?? 'http://localhost:3000',
      inviter: deps.inviter ?? null,
      previewSecret,
      assets: deps.assets ?? null,
      splash360: deps.splash360 ?? null,
      now: deps.now,
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
  // Commande à payer sur place : confirmée tout de suite, envoyée en caisse sans attendre (ADR 0010).
  const onConfirmed = async (order: { orderId: string; tenantId: string }) => {
    await notifyStatus(notify, order.tenantId, order.orderId, 'confirmed');
    await processDispatches(dispatch).catch((error: unknown) =>
      warn('Envoi immédiat à la caisse en échec', { error: String(error) }),
    );
  };
  app.route(
    '/v1/tenants',
    tenantRoutes({
      ...deps,
      hiddenItems,
      onConfirmed,
      handshake: {
        orders: deps.orders,
        restaurants: deps.restaurants,
        tickets: deps.tickets,
        pos: deps.pos,
        now: deps.now,
        timing: deps.posTiming,
        log: warn,
      },
      previewSecret,
      now: deps.now ?? (() => new Date()),
    }),
  );

  app.notFound((c) => apiError(c, 'not_found', 'Route inconnue'));
  app.onError((err, c) => {
    log('error', 'Erreur non gérée', {
      error: err.message,
      path: c.req.path,
      requestId: c.res.headers.get('X-Request-Id') ?? undefined,
    });
    deps.reportError?.(err);
    return apiError(c, 'internal_error', 'Erreur interne');
  });

  // Tâches périodiques (serveur Node) ou au fil des requêtes (Edge) : suite des envois en caisse,
  // contrôles et crédits « Ambassadeur » échus (lot 17), précédés du rapprochement des tickets
  // photographiés avec les ventes Splash360 (lot 20).
  const noTickets: TicketCheckRun = {
    fetched: false,
    verified: 0,
    unpaid: 0,
    notFound: 0,
    flagged: 0,
  };
  const runAmbassador = async () => {
    const ambassador = deps.ambassador;
    const loyalty = deps.loyalty;
    if (!ambassador || !loyalty)
      return { checked: 0, credited: 0, rejected: 0, tickets: noTickets };
    const now = deps.now?.() ?? new Date();
    const tickets = await verifyAmbassadorTickets(
      {
        ambassador,
        restaurants: deps.restaurants,
        sales: deps.posSales,
        source: deps.salesSource,
        log: warn,
      },
      now,
    ).catch((error: unknown) => {
      warn('Vérification des tickets ambassadeur en échec', { error: String(error) });
      return noTickets;
    });
    const processed = await processAmbassadorEntries(
      {
        ambassador,
        loyalty,
        ...(deps.storyChecker ? { storyChecker: deps.storyChecker } : {}),
        log: warn,
      },
      now,
    );
    return { ...processed, tickets };
  };
  return Object.assign(app, { runDispatches: () => processDispatches(dispatch), runAmbassador });
}
