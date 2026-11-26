import type {
  AdminStore,
  AmbassadorStore,
  MemberSessionStore,
  ProximityStore,
  StripeCustomerStore,
} from '@splash360/db';
import {
  LoyaltyDuplicateCustomerError,
  LoyaltyUnsupportedError,
  type LoyaltyMember,
  type LoyaltyProvider,
  type LoyaltyTenant,
  type MemberProfileUpdate,
} from '@splash360/api-loyalty';
import { reservedRewardPoints } from '@splash360/core';
import {
  loyaltyJoinRequestSchema,
  memberProfileUpdateSchema,
  loyaltyLoginRequestSchema,
  otpStartRequestSchema,
  otpVerifyRequestSchema,
  type LoyaltyProgramDto,
  type LoyaltySession,
  type MemberOrdersDto,
  type OtpStartResponse,
} from '@splash360/contracts';
import type { OrderingStore, TenantWithTheme } from '@splash360/db';
import type { Context, Hono } from 'hono';
import { apiError } from '../errors';
import { consumeOtp, startOtp, verifyOtp, type OtpDeps } from '../loyalty/otp';
import { CLIENT_ACTOR, eraseLoyaltyMember } from '../loyalty/erasure';
import { authenticateMember, memberToken, memberView, readMemberToken } from '../loyalty/service';
import type { CardGateway } from '../payments/cards';

/** Nom affiché d'un membre qui n'a pas (encore) donné son prénom. */
const DEFAULT_MEMBER_NAME = 'Membre';
import { orderAccessToken } from '../payments/tokens';

export interface LoyaltyRoutesDeps {
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly tokenSecret: string;
  /** Connexion par simple e-mail (données de test uniquement, ADR 0009). */
  readonly loyaltyDemoLogin?: boolean | undefined;
  /** Connexion par code SMS ou e-mail (lot 10, ADR 0012) ; absent = désactivée. */
  readonly otp?: OtpDeps | undefined;
  /** Version de session des membres (audit M4). */
  readonly memberSessions?: MemberSessionStore | undefined;
  /**
   * « Supprimer mon compte » (ADR 0028) : même effacement qu'au back-office, journalisé
   * (`admin.audit`), avec les données Ambassadeur, « à proximité » et les cartes enregistrées.
   */
  readonly admin?: Pick<AdminStore, 'audit'> | undefined;
  readonly ambassador?: AmbassadorStore | undefined;
  readonly proximity?: ProximityStore | undefined;
  readonly cardGateway?: CardGateway | undefined;
  readonly stripeCustomers?: StripeCustomerStore | undefined;
}

/** Commandes en cours avec cadeau : leurs points sont réservés (ADR 0013). */
type ReservationDeps = Partial<{
  readonly ordering: Pick<OrderingStore, 'rewardHolds' | 'memberOrders'>;
  readonly now: () => Date;
}>;

type Env = { Variables: { tenant: TenantWithTheme } };

const asLoyaltyTenant = (t: TenantWithTheme): LoyaltyTenant => ({
  id: t.id,
  splash360Id: t.splash360Id,
});

/** Lit « Authorization: Bearer <jeton de membre> ». */
export const bearerMember = (c: Context) =>
  /^Bearer (m2\.(?:[0-9a-f-]{36}|\d{1,18})\.[0-9a-z]{1,13}\.\d{1,6}\.[A-Za-z0-9_-]{20,100})$/i.exec(
    c.req.header('Authorization') ?? '',
  )?.[1];

/**
 * Adhésion ; YouFID ne crée un compte que par téléphone (lot 21) : l'inscription par e-mail seul
 * est refusée avec un message clair (un compte existant reste retrouvé par son e-mail).
 */
async function joinOrRefuse(
  c: Context,
  provider: LoyaltyProvider,
  tenant: LoyaltyTenant,
  input: Parameters<LoyaltyProvider['join']>[1],
  deps: Pick<LoyaltyRoutesDeps, 'admin'>,
) {
  try {
    return await provider.join(tenant, input);
  } catch (error) {
    if (error instanceof LoyaltyUnsupportedError) {
      return apiError(
        c,
        'invalid_request',
        'Inscription au club par numéro de mobile uniquement : choisis « SMS »',
      );
    }
    if (error instanceof LoyaltyDuplicateCustomerError) {
      // YouFID « Duplicated user » (réponses du 26/11) : visible au journal du back-office, sans
      // donnée personnelle ; l'équipe fait corriger la fiche par Splash360.
      await deps.admin
        ?.audit({
          tenantId: tenant.id,
          actor: CLIENT_ACTOR,
          action: 'loyalty.youfid_duplicate_user',
          target: null,
          detail: { partner: 'youfid', route: 'registerCustomerByPhone' },
        })
        .catch(() => undefined);
      return apiError(
        c,
        'loyalty_unavailable',
        'Compte club non créé pour le moment : le restaurant est prévenu',
      );
    }
    throw error;
  }
}

/** Club fidélité de l'enseigne (lot 8), monté sous /v1/tenants/:subdomain. */
export function registerLoyaltyRoutes(app: Hono<Env>, deps: LoyaltyRoutesDeps & ReservationDeps) {
  async function context(c: Context<Env>) {
    if (!deps.loyalty) return null;
    const tenant = asLoyaltyTenant(c.get('tenant'));
    const program = await deps.loyalty.getProgram(tenant);
    return program ? { provider: deps.loyalty, tenant, program } : null;
  }

  async function reserved(tenantId: string, memberId: string): Promise<number> {
    if (!deps.ordering) return 0;
    const holds = await deps.ordering.rewardHolds(tenantId, memberId, null);
    return reservedRewardPoints(holds, deps.now?.() ?? new Date());
  }

  async function view(
    ctx: NonNullable<Awaited<ReturnType<typeof context>>>,
    member: LoyaltyMember,
  ) {
    return memberView(
      ctx.provider,
      ctx.tenant,
      ctx.program,
      member,
      await reserved(ctx.tenant.id, member.id),
    );
  }

  /**
   * Session du membre. `confirmed` : connexion prouvée par code (SMS ou e-mail) : nouvelle version
   * de session, les jetons précédents (par exemple d'une adhésion frauduleuse) sont révoqués.
   */
  async function session(c: Context<Env>, memberId: string, created: boolean, confirmed = false) {
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const member = await ctx.provider.getMember(ctx.tenant, memberId);
    if (!member) return apiError(c, 'not_found', 'Compte fidélité introuvable');
    const sessions = deps.memberSessions;
    const version = sessions
      ? confirmed
        ? await sessions.bump(ctx.tenant.id, member.id)
        : await sessions.current(ctx.tenant.id, member.id)
      : 0;
    const body: LoyaltySession = {
      memberToken: memberToken(deps.tokenSecret, ctx.tenant.id, member.id, {
        now: deps.now?.() ?? new Date(),
        version,
      }),
      member: await view(ctx, member),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, created ? 201 : 200);
  }

  app.get('/:subdomain/loyalty/program', async (c) => {
    const ctx = await context(c);
    const body: LoyaltyProgramDto = ctx
      ? {
          enabled: true,
          name: ctx.program.name,
          pointsPerEuro: ctx.program.pointsPerEuro,
          welcomePoints: ctx.program.welcomePoints,
          rewards: ctx.program.rewards.map((r) => ({
            ...r,
            productIds: [...r.productIds],
            categoryIds: [...(r.categoryIds ?? [])],
          })),
          demo: deps.loyaltyDemoLogin === true,
          otp: deps.otp !== undefined,
          partnerErasure: ctx.program.source === 'youfid',
        }
      : { enabled: false };
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  });

  app.post('/:subdomain/loyalty/join', async (c) => {
    // Avec la connexion par code, l'inscription passe par la vérification (sauf données de test).
    if (deps.otp && !deps.loyaltyDemoLogin) return apiError(c, 'not_found', 'Route inconnue');
    const parsed = loyaltyJoinRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Inscription invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const joined = await joinOrRefuse(c, ctx.provider, ctx.tenant, parsed.data, deps);
    if (joined instanceof Response) return joined;
    const { member, created } = joined;
    // Un e-mail déjà inscrit ne donne pas accès au compte sans vérification.
    if (!created && !deps.loyaltyDemoLogin) {
      return apiError(c, 'conflict', 'Cet e-mail a déjà un compte fidélité');
    }
    return session(c, member.id, created);
  });

  app.post('/:subdomain/loyalty/login', async (c) => {
    if (!deps.loyaltyDemoLogin) return apiError(c, 'not_found', 'Route inconnue');
    const parsed = loyaltyLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 'invalid_request', 'E-mail invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const member = await ctx.provider.findByEmail(ctx.tenant, parsed.data.email);
    if (!member) return apiError(c, 'not_found', 'Aucun compte fidélité pour cet e-mail');
    return session(c, member.id, false);
  });

  app.post('/:subdomain/loyalty/otp/start', async (c) => {
    const otp = deps.otp;
    if (!otp) return apiError(c, 'not_found', 'Route inconnue');
    const parsed = otpStartRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Demande de code invalide');
    if (!(await context(c))) return apiError(c, 'not_found', 'Pas de club fidélité');
    const tenant = c.get('tenant');
    const r = await startOtp(
      otp,
      { id: tenant.id, name: tenant.name },
      parsed.data.channel,
      parsed.data.identifier,
    );
    if (!r.ok) {
      if (r.error === 'invalid_identifier') {
        return apiError(
          c,
          'invalid_request',
          parsed.data.channel === 'sms' ? 'Numéro de mobile invalide' : 'Adresse e-mail invalide',
        );
      }
      c.header('Retry-After', String(r.retryAfterSeconds));
      return apiError(c, 'rate_limited', 'Trop de codes demandés : réessaie plus tard');
    }
    const body: OtpStartResponse = {
      sent: true,
      identifier: r.identifier,
      resendInSeconds: r.resendInSeconds,
      ...(r.debugCode ? { debugCode: r.debugCode } : {}),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, 202);
  });

  app.post('/:subdomain/loyalty/otp/verify', async (c) => {
    const otp = deps.otp;
    if (!otp) return apiError(c, 'not_found', 'Route inconnue');
    const parsed = otpVerifyRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Code invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const { channel, identifier, code, name, acceptedTerms } = parsed.data;
    const v = await verifyOtp(otp, ctx.tenant.id, channel, identifier, code);
    if (!v.ok) {
      return v.error === 'otp_expired'
        ? apiError(c, 'otp_expired', 'Code expiré : demande un nouveau code')
        : apiError(c, 'otp_invalid', 'Code incorrect');
    }
    const existing =
      channel === 'sms'
        ? await ctx.provider.findByPhone(ctx.tenant, v.identifier)
        : await ctx.provider.findByEmail(ctx.tenant, v.identifier);
    if (existing) {
      if (!(await consumeOtp(otp, v.challengeId))) {
        return apiError(c, 'otp_expired', 'Code déjà utilisé : demande un nouveau code');
      }
      return session(c, existing.id, false, true);
    }
    // Pas encore de compte : le code reste valable un moment pour accepter les conditions.
    // Le prénom est facultatif (demande du 25/11) : il se complète ensuite dans « Fais connaissance ».
    if (!acceptedTerms) {
      c.header('Cache-Control', 'no-store');
      return c.json({ needsName: true as const });
    }
    if (!(await consumeOtp(otp, v.challengeId))) {
      return apiError(c, 'otp_expired', 'Code déjà utilisé : demande un nouveau code');
    }
    const joined = await joinOrRefuse(
      c,
      ctx.provider,
      ctx.tenant,
      {
        name: name && name.trim().length >= 2 ? name : DEFAULT_MEMBER_NAME,
        phone: channel === 'sms' ? v.identifier : null,
        email: channel === 'email' ? v.identifier : null,
      },
      deps,
    );
    if (joined instanceof Response) return joined;
    return session(c, joined.member.id, joined.created, true);
  });

  app.get('/:subdomain/loyalty/me', async (c) => {
    const memberId = await authenticateMember(deps, c.get('tenant').id, bearerMember(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const member = await ctx.provider.getMember(ctx.tenant, memberId);
    if (!member) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    c.header('Cache-Control', 'no-store');
    return c.json(await view(ctx, member));
  });

  /** Profil complété par le membre (lot 16) : prénom, e-mail, date de naissance, facultatifs. */
  app.patch('/:subdomain/loyalty/me', async (c) => {
    const memberId = await authenticateMember(deps, c.get('tenant').id, bearerMember(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const parsed = memberProfileUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return apiError(c, 'invalid_request', parsed.error.issues[0]?.message ?? 'Profil invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const update = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as MemberProfileUpdate;
    const result = await ctx.provider.updateProfile(ctx.tenant, memberId, update);
    if (!result.ok)
      return result.error === 'email_taken'
        ? apiError(c, 'conflict', 'Cet e-mail est déjà utilisé par un autre compte')
        : apiError(c, 'unauthorized', 'Session fidélité invalide');
    c.header('Cache-Control', 'no-store');
    return c.json(await view(ctx, result.member));
  });

  /**
   * « Supprimer mon compte » (ADR 0028, App Store 5.1.1(v)) : effacement par le membre lui-même,
   * comme au back-office, puis toutes ses sessions révoquées. Idempotent : un jeton authentique
   * d'un compte déjà effacé reçoit aussi 204.
   */
  app.delete('/:subdomain/loyalty/me', async (c) => {
    const tenantId = c.get('tenant').id;
    const token = bearerMember(c);
    const memberId = await authenticateMember(deps, tenantId, token);
    const ctx = await context(c);
    c.header('Cache-Control', 'no-store');
    if (!memberId) {
      const read = readMemberToken(deps.tokenSecret, tenantId, token, deps.now?.() ?? new Date());
      if (read && ctx && !(await ctx.provider.getMember(ctx.tenant, read.memberId)))
        return c.body(null, 204);
      return apiError(c, 'unauthorized', 'Session fidélité invalide');
    }
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const audit = deps.admin;
    await eraseLoyaltyMember(
      {
        ...deps,
        loyalty: ctx.provider,
        audit: (e) => audit?.audit(e) ?? Promise.resolve(),
      },
      ctx.tenant,
      ctx.program,
      memberId,
      CLIENT_ACTOR,
    );
    return c.body(null, 204);
  });

  /** Historique « Mes commandes » (lot 11) : uniquement les commandes du membre connecté. */
  app.get('/:subdomain/loyalty/me/orders', async (c) => {
    const tenant = c.get('tenant');
    const memberId = await authenticateMember(deps, tenant.id, bearerMember(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    if (!deps.ordering) return apiError(c, 'not_found', 'Historique indisponible');
    const before = Number(c.req.query('before'));
    const limit = 20;
    const rows = await deps.ordering.memberOrders(tenant.id, memberId, {
      limit: limit + 1,
      beforeNumber: Number.isSafeInteger(before) && before > 0 ? before : null,
    });
    const page = rows.slice(0, limit);
    const body: MemberOrdersDto = {
      orders: page.map((o) => ({
        orderId: o.id,
        number: o.number,
        status: o.status,
        mode: o.mode,
        paymentMethod: o.paymentMethod,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId,
        restaurantName: o.restaurantName,
        items: o.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          productId: i.productId,
          optionIds: [...i.optionIds],
          note: i.note,
        })),
        accessToken: orderAccessToken(deps.tokenSecret, o.id),
      })),
      nextBefore: rows.length > limit ? (page.at(-1)?.number ?? null) : null,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });
}
