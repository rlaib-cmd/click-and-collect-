import type { LoyaltyProvider, LoyaltyTenant } from '@splash360/api-loyalty';
import {
  loyaltyJoinRequestSchema,
  loyaltyLoginRequestSchema,
  type LoyaltyProgramDto,
  type LoyaltySession,
} from '@splash360/contracts';
import type { TenantWithTheme } from '@splash360/db';
import type { Context, Hono } from 'hono';
import { apiError } from '../errors';
import { memberToken, memberView, verifyMemberToken } from '../loyalty/service';

export interface LoyaltyRoutesDeps {
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly tokenSecret: string;
  /** Connexion par simple e-mail (données de test uniquement, ADR 0009). */
  readonly loyaltyDemoLogin?: boolean | undefined;
}

type Env = { Variables: { tenant: TenantWithTheme } };

const asLoyaltyTenant = (t: TenantWithTheme): LoyaltyTenant => ({
  id: t.id,
  splash360Id: t.splash360Id,
});

/** Lit « Authorization: Bearer <jeton de membre> ». */
const bearerMember = (c: Context) =>
  /^Bearer ([0-9a-f-]{36}_[A-Za-z0-9_-]{20,100})$/i.exec(c.req.header('Authorization') ?? '')?.[1];

/** Club fidélité de l'enseigne (lot 8), monté sous /v1/tenants/:subdomain. */
export function registerLoyaltyRoutes(app: Hono<Env>, deps: LoyaltyRoutesDeps) {
  async function context(c: Context<Env>) {
    if (!deps.loyalty) return null;
    const tenant = asLoyaltyTenant(c.get('tenant'));
    const program = await deps.loyalty.getProgram(tenant);
    return program ? { provider: deps.loyalty, tenant, program } : null;
  }

  async function session(c: Context<Env>, memberId: string, created: boolean) {
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const member = await ctx.provider.getMember(ctx.tenant, memberId);
    if (!member) return apiError(c, 'not_found', 'Compte fidélité introuvable');
    const body: LoyaltySession = {
      memberToken: memberToken(deps.tokenSecret, ctx.tenant.id, member.id),
      member: await memberView(ctx.provider, ctx.tenant, ctx.program, member),
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
          rewards: ctx.program.rewards.map((r) => ({ ...r })),
          demo: deps.loyaltyDemoLogin === true,
        }
      : { enabled: false };
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(body);
  });

  app.post('/:subdomain/loyalty/join', async (c) => {
    const parsed = loyaltyJoinRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Inscription invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const { member, created } = await ctx.provider.join(ctx.tenant, parsed.data);
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

  app.get('/:subdomain/loyalty/me', async (c) => {
    const memberId = verifyMemberToken(deps.tokenSecret, c.get('tenant').id, bearerMember(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const ctx = await context(c);
    if (!ctx) return apiError(c, 'not_found', 'Pas de club fidélité');
    const member = await ctx.provider.getMember(ctx.tenant, memberId);
    if (!member) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    c.header('Cache-Control', 'no-store');
    return c.json(await memberView(ctx.provider, ctx.tenant, ctx.program, member));
  });
}
