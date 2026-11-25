import type { LoyaltyProvider } from '@splash360/api-loyalty';
import { MenuUnavailableError, type MenuCache } from '@splash360/api-menu';
import {
  canAssignRole,
  normalizePromoCode,
  roleNeedsRestaurant,
  validatePromoDefinition,
} from '@splash360/core';
import {
  createTenantSchema,
  inviteSchema,
  legalSchema,
  pointsAdjustSchema,
  menuOverrideSchema,
  promoInputSchema,
  type AdminPromoDto,
  refundRequestSchema,
  settingsSchema,
  staffUpdateSchema,
  statusChangeSchema,
  themeUpdateSchema,
  updateTenantSchema,
  type AdminMenu,
  type AdminOrderDetail,
  type ClubMemberDto,
  type Dashboard,
  type Me,
  type ThemeDraftState,
} from '@splash360/contracts';
import { DEFAULT_THEME, themeChanges } from '@splash360/theme';
import type {
  AdminStore,
  PromoAdminStore,
  OperationsStore,
  OrderReader,
  PaymentStore,
  RestaurantStore,
  TenantStore,
  ThemeRecord,
} from '@splash360/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  allow,
  requireStaff,
  shortReadCache,
  restaurantScope,
  type AdminEnv,
  type TokenVerifier,
} from '../admin/auth';
import type { AuthInviter } from '../admin/invite';
import { apiError } from '../errors';
import { toMenuDto } from '../menu-dto';
import { notifyStatus, type NotifyDeps } from '../notifications/service';
import type { PaymentGateway } from '../payments/gateway';
import { refundOrder } from '../payments/service';
import {
  checkLogo,
  LOGO_CONTENT_TYPES,
  logoPath,
  MAX_LOGO_BYTES,
  type AssetStorage,
} from '../admin/logo';
import { createPreviewToken, PREVIEW_TTL_MS } from '../admin/theme-preview';

export interface AdminRoutesDeps extends NotifyDeps {
  readonly verifier: TokenVerifier;
  readonly admin: AdminStore;
  /** Codes promo de l'enseigne (lot 11) ; absent = page indisponible. */
  readonly promos?: PromoAdminStore | undefined;
  readonly tenants: TenantStore;
  readonly restaurants: RestaurantStore;
  readonly orders: OrderReader;
  readonly operations: OperationsStore;
  readonly payments: PaymentStore;
  readonly gateway: PaymentGateway | null;
  readonly menus: MenuCache;
  /** Club fidélité (Splash360 ou données de test) ; absent = pas de fidélité. */
  readonly loyalty?: LoyaltyProvider | undefined;
  /** URL publique du back-office (retours de l'inscription Stripe). */
  readonly adminUrl: string;
  /** Envoi des invitations Supabase Auth ; null : non configuré (aucun e-mail envoyé). */
  readonly inviter?: AuthInviter | null;
  /** Studio design (lot 12) : secret des liens d'aperçu du brouillon. */
  readonly previewSecret?: string;
  /** Stockage des logos téléversés ; null : téléversement indisponible (URL seulement). */
  readonly assets?: AssetStorage | null;
  /** API Splash360 réelle (ADR 0018) ; null : identifiants absents, démonstration seulement. */
  readonly splash360?: Splash360Probe | null | undefined;
  readonly now?: (() => Date) | undefined;
}

/** Test de connexion à Splash360 depuis le back-office : jeton, puis lecture de la carte. */
export interface Splash360Probe {
  probe(): Promise<{ products: number; categories: number }>;
}

type C = Context<AdminEnv>;

async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Routes du back-office (section 6, ADR 0005). Chaque action sensible est journalisée. */
export function adminRoutes(deps: AdminRoutesDeps) {
  const app = new Hono<AdminEnv>();
  app.use('*', requireStaff(deps));
  app.use('*', shortReadCache());

  const ctx = (c: C) => c.get('admin');
  const tenantId = (c: C) => ctx(c).tenant?.id ?? '';
  const audit = (c: C, action: string, target: string | null, detail?: Record<string, unknown>) =>
    deps.admin.audit({
      tenantId: ctx(c).tenant?.id ?? null,
      actor: ctx(c).staff,
      action,
      target,
      detail: detail ?? null,
    });

  /**
   * Invitation par e-mail (lien « Choisir mon mot de passe »). Un échec n'annule pas le compte :
   * il est signalé (invitationSent: false) et journalisé, l'invitation peut être renvoyée.
   */
  async function sendInvite(c: C, tenant: string | null, email: string): Promise<boolean> {
    if (!deps.inviter) return false;
    const outcome = await deps.inviter.invite(email);
    await deps.admin.audit({
      tenantId: tenant,
      actor: ctx(c).staff,
      action: outcome === 'failed' ? 'staff.invite_failed' : 'staff.invite_sent',
      target: email,
      detail: { outcome },
    });
    return outcome !== 'failed';
  }

  /** Restaurant de l'enseigne courante, dans le périmètre de l'utilisateur. */
  async function restaurantFor(c: C, id: string) {
    const scope = restaurantScope(ctx(c));
    if (scope && scope !== id) return null;
    return deps.restaurants.findById(tenantId(c), id);
  }

  app.get('/me', (c) => {
    const { staff, tenant } = ctx(c);
    const me: Me = {
      email: staff.email,
      name: staff.name,
      role: staff.role,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            subdomain: tenant.subdomain,
            logoUrl: tenant.theme?.logoUrl ?? null,
            primaryColor: tenant.theme?.primaryColor ?? '#3730A3',
            status: tenant.status,
          }
        : null,
      restaurantId: staff.restaurantId,
    };
    return c.json(me);
  });

  // ——— Enseignes (super-administrateur Splash360) ———
  app.get(
    '/tenants',
    async (c) => allow(c, 'platform', false) ?? c.json({ tenants: await deps.admin.listTenants() }),
  );

  app.post('/tenants', async (c) => {
    const denied = allow(c, 'platform', false);
    if (denied) return denied;
    const input = await body(c, createTenantSchema);
    if (!input) return apiError(c, 'invalid_request', 'Enseigne invalide');
    try {
      const created = await deps.admin.createTenant(input);
      await deps.admin.audit({
        tenantId: created.tenantId,
        actor: ctx(c).staff,
        action: 'tenant.create',
        target: input.subdomain,
      });
      const invitationSent = await sendInvite(c, created.tenantId, input.adminEmail);
      return c.json({ ...created, invitationSent }, 201);
    } catch {
      return apiError(c, 'conflict', 'Sous-domaine ou identifiant Splash360 déjà utilisé');
    }
  });

  app.patch('/tenants/:id', async (c) => {
    const denied = allow(c, 'platform', false);
    if (denied) return denied;
    const input = await body(c, updateTenantSchema);
    if (!input) return apiError(c, 'invalid_request', 'Modification invalide');
    if (!(await deps.admin.updateTenant(c.req.param('id'), input)))
      return apiError(c, 'not_found', 'Enseigne inconnue');
    await deps.admin.audit({
      tenantId: c.req.param('id'),
      actor: ctx(c).staff,
      action: 'tenant.update',
      target: c.req.param('id'),
      detail: input,
    });
    return c.body(null, 204);
  });

  app.delete('/tenants/:id', async (c) => {
    const denied = allow(c, 'platform', false);
    if (denied) return denied;
    const id = c.req.param('id');
    const result = await deps.admin.deleteTenant(id);
    if (result === 'not_found') return apiError(c, 'not_found', 'Enseigne inconnue');
    if (result === 'has_orders')
      return apiError(c, 'conflict', 'Cette enseigne a des commandes : bloquez-la plutôt');
    // L'enseigne et son journal ont disparu : la trace reste au niveau de la plateforme.
    await deps.admin.audit({
      tenantId: null,
      actor: ctx(c).staff,
      action: 'tenant.delete',
      target: id,
    });
    return c.body(null, 204);
  });

  // ——— Restaurants ———
  app.get('/restaurants', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    const scope = restaurantScope(ctx(c));
    const list = (await deps.restaurants.listByTenant(tenantId(c))).filter(
      (r) => !scope || r.id === scope,
    );
    return c.json({
      restaurants: list.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        status: r.status,
        stripeAccountId: r.stripeAccountId,
        stripeChargesEnabled: r.stripeChargesEnabled,
        splash360Live: r.splash360Live,
      })),
      splash360Configured: Boolean(deps.splash360),
    });
  });

  // ——— Caisse et carte Splash360 (lot 14, ADR 0018) ———
  app.post('/restaurants/:id/splash360', async (c) => {
    const denied = allow(c, 'payments');
    if (denied) return denied;
    const input = await body(c, z.object({ live: z.boolean() }));
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!input || !restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    if (input.live && !deps.splash360) {
      return apiError(c, 'conflict', 'Identifiants Splash360 absents du serveur');
    }
    const changed = await deps.restaurants.setSplash360Live(tenantId(c), restaurant.id, input.live);
    if (!changed) {
      return apiError(
        c,
        'conflict',
        'Les accès Splash360 du serveur sont déjà branchés sur un autre restaurant (un accès par restaurant)',
      );
    }
    deps.menus.invalidate(restaurant.id);
    await audit(c, input.live ? 'splash360.connect' : 'splash360.disconnect', restaurant.id);
    return c.body(null, 204);
  });

  app.post('/restaurants/:id/splash360/test', async (c) => {
    const denied = allow(c, 'payments');
    if (denied) return denied;
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    if (!deps.splash360) {
      return c.json({ ok: false, message: 'Identifiants Splash360 absents du serveur' });
    }
    try {
      const result = await deps.splash360.probe();
      await audit(c, 'splash360.test', restaurant.id, { ok: true });
      return c.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await audit(c, 'splash360.test', restaurant.id, { ok: false });
      return c.json({ ok: false, message });
    }
  });

  app.post('/restaurants/:id/pause', async (c) => {
    const denied = allow(c, 'menu.pause');
    if (denied) return denied;
    const input = await body(c, z.object({ paused: z.boolean() }));
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!input || !restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    await deps.admin.setRestaurantStatus(
      tenantId(c),
      restaurant.id,
      input.paused ? 'paused' : 'active',
    );
    await audit(c, input.paused ? 'restaurant.pause' : 'restaurant.resume', restaurant.id);
    return c.body(null, 204);
  });

  app.post('/restaurants/:id/stripe/onboarding', async (c) => {
    const denied = allow(c, 'payments');
    if (denied) return denied;
    if (!deps.gateway) return apiError(c, 'payments_unavailable', 'Stripe non configuré');
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    let accountId = restaurant.stripeAccountId;
    if (!accountId) {
      accountId = await deps.gateway.createConnectedAccount({
        restaurantId: restaurant.id,
        tenantId: tenantId(c),
        email: ctx(c).staff.email,
        businessName: restaurant.name,
      });
      await deps.restaurants.setStripeAccount(tenantId(c), restaurant.id, accountId);
    }
    const back = `${deps.adminUrl}/paiement?restaurant=${restaurant.id}`;
    const url = await deps.gateway.createOnboardingLink(accountId, {
      refreshUrl: back,
      returnUrl: back,
    });
    await audit(c, 'stripe.onboarding', restaurant.id, { accountId });
    return c.json({ url });
  });

  // ——— Commandes ———
  app.get('/orders', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    const statuses = c.req.query('status')?.split(',').filter(Boolean);
    const since = c.req.query('since');
    const scope = restaurantScope(ctx(c));
    const orders = await deps.admin.listOrders(tenantId(c), {
      restaurantId: scope ?? c.req.query('restaurantId'),
      statuses,
      since: since && !Number.isNaN(Date.parse(since)) ? new Date(since) : undefined,
      limit: 200,
    });
    c.header('Cache-Control', 'no-store');
    return c.json({ orders });
  });

  app.get('/orders/:id', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    const d = await deps.orders.getOrderDetail(tenantId(c), c.req.param('id'));
    const scope = restaurantScope(ctx(c));
    if (!d || (scope && d.restaurantId !== scope))
      return apiError(c, 'not_found', 'Commande inconnue');
    const detail: AdminOrderDetail = {
      id: d.id,
      number: d.number,
      restaurantId: d.restaurantId,
      status: d.status as AdminOrderDetail['status'],
      mode: d.mode,
      estimatedAt: d.estimatedAt,
      scheduled: d.requestedSlot !== null,
      totals: d.totals,
      refundedCents: d.refundedCents,
      customer: d.customer,
      deliveryAddress: d.deliveryAddress,
      lines: d.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        totalCents: l.totalCents,
        options: l.options.map((o) => o.name),
        note: l.note,
      })),
      history: d.events.map((e) => ({ ...e })),
    };
    return c.json(detail);
  });

  app.post('/orders/:id/status', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    const input = await body(c, statusChangeSchema);
    if (!input) return apiError(c, 'invalid_request', 'Statut invalide');
    const d = await deps.orders.getOrderDetail(tenantId(c), c.req.param('id'));
    const scope = restaurantScope(ctx(c));
    if (!d || (scope && d.restaurantId !== scope))
      return apiError(c, 'not_found', 'Commande inconnue');
    const change = await deps.operations.changeStatus(
      tenantId(c),
      d.id,
      input.status,
      `staff:${ctx(c).staff.id}`,
    );
    if (!change.ok) return apiError(c, 'conflict', `Changement impossible (${change.error})`);
    if (input.status === 'cancelled') await audit(c, 'order.cancel', d.id, { number: d.number });
    await notifyStatus(deps, tenantId(c), d.id, input.status);
    return c.json({ status: input.status });
  });

  app.post('/orders/:id/refund', async (c) => {
    const denied = allow(c, 'orders.refund');
    if (denied) return denied;
    const input = await body(c, refundRequestSchema);
    if (!input) return apiError(c, 'invalid_request', 'Montant invalide');
    const result = await refundOrder(
      { payments: deps.payments, gateway: deps.gateway },
      {
        tenantId: tenantId(c),
        orderId: c.req.param('id'),
        amountCents: input.amountCents,
        actor: `staff:${ctx(c).staff.id}`,
        requestId: input.requestId,
      },
    );
    if (!result.ok) {
      if (result.error === 'not_found') return apiError(c, 'not_found', 'Commande inconnue');
      if (result.error === 'payments_unavailable')
        return apiError(c, 'payments_unavailable', 'Stripe non configuré');
      return apiError(
        c,
        'conflict',
        result.error === 'amount_too_high'
          ? 'Montant supérieur au reste à rembourser'
          : 'Commande non remboursable',
      );
    }
    await audit(c, 'order.refund', c.req.param('id'), { amountCents: input.amountCents });
    return c.json(result);
  });

  app.get('/alerts', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    return c.json({ alerts: await deps.operations.listFailedDispatches(tenantId(c)) });
  });

  app.post('/orders/:id/dispatch-retry', async (c) => {
    const denied = allow(c, 'orders');
    if (denied) return denied;
    if (!(await deps.operations.retryDispatch(tenantId(c), c.req.param('id'))))
      return apiError(c, 'not_found', 'Aucun envoi en échec');
    await audit(c, 'order.dispatch_retry', c.req.param('id'));
    return c.body(null, 204);
  });

  // ——— Design et textes légaux ———
  app.get(
    '/theme',
    async (c) => allow(c, 'design') ?? c.json(await deps.admin.getTheme(tenantId(c))),
  );

  app.put('/theme', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    const input = await body(c, themeUpdateSchema);
    if (!input) return apiError(c, 'invalid_request', 'Design invalide');
    await deps.admin.updateTheme(tenantId(c), input);
    await audit(c, 'theme.update', null, input);
    return c.body(null, 204);
  });

  // ——— Studio design (lot 12, ADR 0016) : brouillon, aperçu, publication ———
  const liveTheme = async (c: C): Promise<ThemeRecord> =>
    (await deps.admin.getTheme(tenantId(c))) ?? { ...DEFAULT_THEME, loyaltyColor: null };
  /** Brouillon valide, ou null (absent, ou devenu invalide après une évolution du contrat). */
  const draftTheme = async (c: C) => {
    const stored = await deps.admin.getThemeDraft(tenantId(c));
    const parsed = stored ? themeUpdateSchema.safeParse(stored.draft) : null;
    return parsed?.success && stored ? { theme: parsed.data, updatedAt: stored.updatedAt } : null;
  };

  app.get('/theme/draft', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    const draft = await draftTheme(c);
    const state: ThemeDraftState = {
      live: await liveTheme(c),
      draft: draft?.theme ?? null,
      draftUpdatedAt: draft?.updatedAt ?? null,
    };
    return c.json(state);
  });

  app.put('/theme/draft', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    const input = await body(c, themeUpdateSchema);
    if (!input) return apiError(c, 'invalid_request', 'Design invalide');
    await deps.admin.setThemeDraft(tenantId(c), input);
    return c.body(null, 204);
  });

  app.post('/theme/discard', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    await deps.admin.setThemeDraft(tenantId(c), null);
    await audit(c, 'theme.discard', null);
    return c.body(null, 204);
  });

  app.post('/theme/publish', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    const draft = await draftTheme(c);
    if (!draft) return apiError(c, 'conflict', 'Aucun brouillon à publier');
    const changes = themeChanges(await liveTheme(c), draft.theme);
    await deps.admin.publishTheme(tenantId(c), draft.theme);
    await audit(c, 'theme.publish', null, { changes });
    return c.json({ changes });
  });

  app.post('/theme/preview-link', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    if (!deps.previewSecret) return apiError(c, 'not_found', 'Aperçu indisponible');
    const now = deps.now?.() ?? new Date();
    const token = createPreviewToken(deps.previewSecret, tenantId(c), now);
    return c.json({ token, expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString() });
  });

  app.post('/theme/logo', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    if (!deps.assets) return apiError(c, 'storage_unavailable', 'Téléversement indisponible');
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > MAX_LOGO_BYTES)
      return apiError(c, 'payload_too_large', 'Logo trop lourd : 2 Mo maximum');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const check = checkLogo(bytes);
    if (!check.ok) {
      if (check.error === 'logo_too_large')
        return apiError(c, 'payload_too_large', 'Logo trop lourd : 2 Mo maximum');
      return apiError(c, 'invalid_request', 'Format non accepté : PNG, JPEG ou WebP');
    }
    let logoUrl: string;
    try {
      logoUrl = await deps.assets.put(
        logoPath(tenantId(c), bytes, check.format),
        bytes,
        LOGO_CONTENT_TYPES[check.format],
      );
    } catch {
      return apiError(c, 'storage_unavailable', 'Stockage du logo momentanément indisponible');
    }
    const base = (await draftTheme(c))?.theme ?? (await liveTheme(c));
    await deps.admin.setThemeDraft(tenantId(c), { ...base, logoUrl });
    await audit(c, 'theme.logo_upload', null, { logoUrl, bytes: bytes.length });
    return c.json({ logoUrl }, 201);
  });

  app.get(
    '/legal',
    async (c) => allow(c, 'design') ?? c.json({ text: await deps.admin.getLegalText(tenantId(c)) }),
  );

  app.put('/legal', async (c) => {
    const denied = allow(c, 'design');
    if (denied) return denied;
    const input = await body(c, legalSchema);
    if (!input) return apiError(c, 'invalid_request', 'Texte invalide');
    await deps.admin.setLegalText(tenantId(c), input.text);
    await audit(c, 'legal.update', null);
    return c.body(null, 204);
  });

  // ——— Réglages de commande ———
  app.get('/restaurants/:id/settings', async (c) => {
    const denied = allow(c, 'restaurants.settings');
    if (denied) return denied;
    const restaurant = await restaurantFor(c, c.req.param('id'));
    const settings = restaurant ? await deps.admin.getSettings(tenantId(c), restaurant.id) : null;
    return settings ? c.json(settings) : apiError(c, 'not_found', 'Restaurant inconnu');
  });

  app.put('/restaurants/:id/settings', async (c) => {
    const denied = allow(c, 'restaurants.settings');
    if (denied) return denied;
    const input = await body(c, settingsSchema);
    if (!input) return apiError(c, 'invalid_request', 'Réglages invalides');
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    await deps.admin.saveSettings(tenantId(c), restaurant.id, input);
    await audit(c, 'settings.update', restaurant.id);
    return c.body(null, 204);
  });

  // ——— Carte (lecture seule, réglages locaux) ———
  app.get('/restaurants/:id/menu', async (c) => {
    const denied = allow(c, 'menu.pause');
    if (denied) return denied;
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    try {
      const cached = await deps.menus.get({
        restaurantId: restaurant.id,
        splash360RestaurantId: restaurant.splash360Id,
        live: restaurant.splash360Live,
      });
      const overrides = await deps.admin.listMenuOverrides(tenantId(c), restaurant.id);
      // Aperçu complet (rien de masqué) ; les réglages sont renvoyés à part.
      const full = toMenuDto(cached.menu, restaurant.id, cached.fetchedAt, cached.stale);
      const body: AdminMenu = {
        ...full,
        overrides,
        warnings: cached.menu.products.flatMap((p) => [
          ...(p.imageUrl ? [] : [{ productId: p.id, name: p.name, issue: 'no_photo' as const }]),
          ...(p.priceCents > 0
            ? []
            : [{ productId: p.id, name: p.name, issue: 'no_price' as const }]),
        ]),
      };
      return c.json(body);
    } catch (error) {
      if (error instanceof MenuUnavailableError)
        return apiError(c, 'menu_unavailable', 'Carte indisponible');
      throw error;
    }
  });

  app.post('/restaurants/:id/menu/refresh', async (c) => {
    const denied = allow(c, 'menu.manage');
    if (denied) return denied;
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!restaurant) return apiError(c, 'not_found', 'Restaurant inconnu');
    deps.menus.invalidate(restaurant.id);
    return c.body(null, 204);
  });

  app.put('/restaurants/:id/menu/overrides', async (c) => {
    const denied = allow(c, 'menu.pause');
    if (denied) return denied;
    const input = await body(c, z.object({ overrides: z.array(menuOverrideSchema).max(500) }));
    const restaurant = await restaurantFor(c, c.req.param('id'));
    if (!input || !restaurant) return apiError(c, 'invalid_request', 'Réglages de carte invalides');
    for (const o of input.overrides)
      await deps.admin.setMenuOverride(tenantId(c), restaurant.id, o);
    await audit(c, 'menu.overrides', restaurant.id, { count: input.overrides.length });
    return c.body(null, 204);
  });

  // ——— Tableau de bord ———
  app.get('/dashboard', async (c) => {
    const denied = allow(c, 'dashboard');
    if (denied) return denied;
    const q = z
      .object({ from: z.iso.date(), to: z.iso.date(), restaurantId: z.uuid().optional() })
      .safeParse({
        from: c.req.query('from'),
        to: c.req.query('to'),
        restaurantId: c.req.query('restaurantId'),
      });
    if (!q.success) return apiError(c, 'invalid_request', 'Période invalide');
    const to = new Date(`${q.data.to}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    const raw = await deps.admin.dashboard(
      tenantId(c),
      new Date(`${q.data.from}T00:00:00Z`),
      to,
      q.data.restaurantId,
    );
    const stats: Dashboard = {
      ...raw,
      byMode: { ...raw.byMode },
      byDay: [...raw.byDay],
      byRestaurant: [...raw.byRestaurant],
    };
    return c.json(stats);
  });

  // ——— Clients finaux (RGPD) ———
  app.get('/customers', async (c) => {
    const denied = allow(c, 'customers');
    if (denied) return denied;
    const search = c.req.query('q')?.trim().slice(0, 100) || null;
    return c.json({ customers: await deps.admin.listCustomers(tenantId(c), search, 200) });
  });

  app.get('/customers/export', async (c) => {
    const denied = allow(c, 'customers');
    if (denied) return denied;
    const rows = await deps.admin.listCustomers(tenantId(c), null, 100_000);
    const esc = (v: string | number | boolean | null) => {
      const s = v === null ? '' : String(v);
      // Neutralise les formules à l'ouverture dans un tableur.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = [
      'nom;email;telephone;consentement_marketing;commandes;montant_total_euros;derniere_commande',
      ...rows.map((r) =>
        [
          r.name,
          r.email,
          r.phone,
          r.marketingConsent ? 'oui' : 'non',
          r.orders,
          (r.spentCents / 100).toFixed(2).replace('.', ','),
          r.lastOrderAt,
        ]
          .map(esc)
          .join(';'),
      ),
    ].join('\n');
    await audit(c, 'customers.export', null, { count: rows.length });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="clients.csv"');
    return c.body(`\uFEFF${csv}`);
  });

  app.delete('/customers/:id', async (c) => {
    const denied = allow(c, 'customers');
    if (denied) return denied;
    if (!(await deps.admin.anonymizeCustomer(tenantId(c), c.req.param('id'))))
      return apiError(c, 'not_found', 'Client inconnu');
    await audit(c, 'customer.delete', c.req.param('id'));
    return c.body(null, 204);
  });

  // ——— Codes promo (lot 11, ADR 0015) ———
  app.get('/promos', async (c) => {
    const denied = allow(c, 'promos');
    if (denied) return denied;
    if (!deps.promos) return apiError(c, 'not_found', 'Codes promo indisponibles');
    const promos: AdminPromoDto[] = (await deps.promos.listPromos(tenantId(c))).map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind,
      value: p.value,
      minSubtotalCents: p.minSubtotalCents,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      maxUses: p.maxUses,
      active: p.active,
      uses: p.uses,
      createdAt: p.createdAt,
    }));
    return c.json({ promos });
  });

  app.post('/promos', async (c) => {
    const denied = allow(c, 'promos');
    if (denied) return denied;
    if (!deps.promos) return apiError(c, 'not_found', 'Codes promo indisponibles');
    const input = await body(c, promoInputSchema);
    const code = input ? normalizePromoCode(input.code) : null;
    if (!input || !code) return apiError(c, 'invalid_request', 'Code promo invalide');
    const promo = {
      code,
      kind: input.kind,
      value: input.value,
      minSubtotalCents: input.minSubtotalCents,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxUses: input.maxUses,
      active: true,
    };
    const problem = validatePromoDefinition(promo);
    if (problem) return apiError(c, 'invalid_request', `Code promo invalide (${problem})`);
    const created = await deps.promos.createPromo(tenantId(c), promo);
    if (created === 'conflict') return apiError(c, 'conflict', 'Ce code existe déjà');
    await audit(c, 'promo.create', code, { kind: promo.kind, value: promo.value });
    return c.json(created, 201);
  });

  app.patch('/promos/:id', async (c) => {
    const denied = allow(c, 'promos');
    if (denied) return denied;
    if (!deps.promos) return apiError(c, 'not_found', 'Codes promo indisponibles');
    const input = await body(c, z.object({ active: z.boolean() }));
    if (!input) return apiError(c, 'invalid_request', 'Modification invalide');
    if (!(await deps.promos.setPromoActive(tenantId(c), c.req.param('id'), input.active)))
      return apiError(c, 'not_found', 'Code promo inconnu');
    await audit(c, input.active ? 'promo.enable' : 'promo.disable', c.req.param('id'));
    return c.body(null, 204);
  });

  // ——— Équipe et journal ———
  app.get(
    '/staff',
    async (c) => allow(c, 'team') ?? c.json({ staff: await deps.admin.listStaff(tenantId(c)) }),
  );

  app.post('/staff', async (c) => {
    const denied = allow(c, 'team');
    if (denied) return denied;
    const input = await body(c, inviteSchema);
    if (!input) return apiError(c, 'invalid_request', 'Invitation invalide');
    if (!canAssignRole(ctx(c).staff.role, input.role))
      return apiError(c, 'forbidden', 'Droits insuffisants');
    if (input.restaurantId && !(await deps.restaurants.findById(tenantId(c), input.restaurantId))) {
      return apiError(c, 'not_found', 'Restaurant inconnu');
    }
    try {
      const staff = await deps.admin.inviteStaff({ ...input, tenantId: tenantId(c) });
      await audit(c, 'staff.invite', staff.email, { role: staff.role });
      const invitationSent = await sendInvite(c, tenantId(c), staff.email);
      return c.json({ ...staff, invitationSent }, 201);
    } catch {
      return apiError(c, 'conflict', 'Ce compte existe déjà');
    }
  });

  app.post('/staff/:id/invite', async (c) => {
    const denied = allow(c, 'team');
    if (denied) return denied;
    const member = (await deps.admin.listStaff(tenantId(c))).find(
      (s) => s.id === c.req.param('id'),
    );
    if (!member) return apiError(c, 'not_found', 'Compte inconnu');
    return c.json({ invitationSent: await sendInvite(c, tenantId(c), member.email) });
  });

  app.patch('/staff/:id', async (c) => {
    const denied = allow(c, 'team');
    if (denied) return denied;
    const input = await body(c, staffUpdateSchema);
    if (!input) return apiError(c, 'invalid_request', 'Modification invalide');
    const id = c.req.param('id');
    if (id === ctx(c).staff.id)
      return apiError(c, 'conflict', 'Vous ne pouvez pas modifier votre propre compte');
    const member = (await deps.admin.listStaff(tenantId(c))).find((m) => m.id === id);
    if (!member) return apiError(c, 'not_found', 'Compte inconnu');
    if (input.role !== undefined) {
      if (!canAssignRole(ctx(c).staff.role, input.role))
        return apiError(c, 'forbidden', 'Droits insuffisants');
      // Propriétaire : toute l'enseigne. Gérant : restaurant facultatif. Équipier : obligatoire.
      const restaurantId = input.role === 'tenant_admin' ? null : (input.restaurantId ?? null);
      if (roleNeedsRestaurant(input.role) && !restaurantId)
        return apiError(c, 'invalid_request', 'Un équipier est rattaché à un restaurant');
      if (restaurantId && !(await deps.restaurants.findById(tenantId(c), restaurantId)))
        return apiError(c, 'not_found', 'Restaurant inconnu');
      await deps.admin.updateStaffRole(tenantId(c), id, input.role, restaurantId);
      await audit(c, 'staff.role', member.email, { from: member.role, to: input.role });
    }
    if (input.disabled !== undefined) {
      await deps.admin.setStaffDisabled(tenantId(c), id, input.disabled);
      await audit(c, input.disabled ? 'staff.disable' : 'staff.enable', id);
    }
    return c.body(null, 204);
  });

  app.delete('/staff/:id', async (c) => {
    const denied = allow(c, 'team');
    if (denied) return denied;
    if (c.req.param('id') === ctx(c).staff.id)
      return apiError(c, 'conflict', 'Vous ne pouvez pas supprimer votre propre compte');
    if (!(await deps.admin.deleteStaff(tenantId(c), c.req.param('id'))))
      return apiError(c, 'not_found', 'Compte inconnu');
    await audit(c, 'staff.delete', c.req.param('id'));
    return c.body(null, 204);
  });

  // ——— Club fidélité (lot 9) : la fidélité reste chez Splash360, via LoyaltyProvider ———
  async function club(c: C) {
    const tenant = ctx(c).tenant;
    if (!deps.loyalty || !tenant) return null;
    const ref = { id: tenant.id, splash360Id: tenant.splash360Id };
    return (await deps.loyalty.getProgram(ref)) ? { provider: deps.loyalty, ref } : null;
  }

  app.get('/loyalty/members', async (c) => {
    const denied = allow(c, 'loyalty');
    if (denied) return denied;
    const cl = await club(c);
    if (!cl) return apiError(c, 'not_found', 'Pas de club fidélité');
    const search = c.req.query('q')?.trim().slice(0, 100) || null;
    const members: ClubMemberDto[] = (await cl.provider.listMembers(cl.ref, search, 200)).map(
      (m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        points: m.points,
        cardCode: m.cardCode,
        createdAt: m.createdAt,
      }),
    );
    return c.json({ members });
  });

  app.post('/loyalty/members/:id/adjust', async (c) => {
    const denied = allow(c, 'loyalty');
    if (denied) return denied;
    const input = await body(c, pointsAdjustSchema);
    if (!input) return apiError(c, 'invalid_request', 'Correction invalide');
    const cl = await club(c);
    if (!cl) return apiError(c, 'not_found', 'Pas de club fidélité');
    const result = await cl.provider.adjustPoints(
      cl.ref,
      c.req.param('id'),
      input.delta,
      input.reason,
    );
    if (!result.ok)
      return result.error === 'unknown_member'
        ? apiError(c, 'not_found', 'Membre inconnu')
        : apiError(c, 'conflict', 'Le solde ne peut pas devenir négatif');
    await audit(c, 'loyalty.adjust', c.req.param('id'), {
      delta: input.delta,
      reason: input.reason,
    });
    return c.json({ points: result.member.points });
  });

  app.delete('/loyalty/members/:id', async (c) => {
    const denied = allow(c, 'loyalty');
    if (denied) return denied;
    const cl = await club(c);
    if (!cl) return apiError(c, 'not_found', 'Pas de club fidélité');
    if (!(await cl.provider.deleteMember(cl.ref, c.req.param('id'))))
      return apiError(c, 'not_found', 'Membre inconnu');
    await audit(c, 'loyalty.member.delete', c.req.param('id'));
    return c.body(null, 204);
  });

  app.get(
    '/audit',
    async (c) =>
      allow(c, 'audit') ?? c.json({ entries: await deps.admin.listAudit(tenantId(c), 200) }),
  );

  return app;
}
