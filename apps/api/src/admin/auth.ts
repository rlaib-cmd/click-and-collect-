import type { AdminStore, StaffUser, TenantStore, TenantWithTheme } from '@splash360/db';
import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { apiError } from '../errors';

/** Vérifie un jeton de session Supabase Auth et renvoie l'utilisateur. */
export interface TokenVerifier {
  verify(token: string): Promise<{ userId: string; email: string } | null>;
}

/**
 * JWKS (clés asymétriques Supabase, recommandé) ou secret HS256 (développement local).
 * Audience « authenticated », émetteur vérifié si fourni.
 */
export function createSupabaseVerifier(options: {
  jwksUrl?: string | undefined;
  secret?: string | undefined;
  issuer?: string | undefined;
}): TokenVerifier {
  const key: JWTVerifyGetKey | Uint8Array | null = options.jwksUrl
    ? createRemoteJWKSet(new URL(options.jwksUrl))
    : options.secret
      ? new TextEncoder().encode(options.secret)
      : null;
  return {
    async verify(token) {
      if (!key) return null;
      try {
        const { payload } = await jwtVerify(token, key as Uint8Array, {
          audience: 'authenticated',
          ...(options.issuer ? { issuer: options.issuer } : {}),
        });
        const email = typeof payload.email === 'string' ? payload.email : null;
        return payload.sub && email ? { userId: payload.sub, email } : null;
      } catch {
        return null;
      }
    },
  };
}

export interface AdminContext {
  readonly staff: StaffUser;
  /** Enseigne sur laquelle on agit : la sienne, ou celle choisie par le super-administrateur. */
  readonly tenant: TenantWithTheme | null;
}

export type AdminEnv = { Variables: { admin: AdminContext } };

/**
 * Authentifie la requête et fixe l'enseigne visée. Un super-administrateur choisit l'enseigne
 * par l'en-tête X-Tenant-Id (« se connecter en tant que »).
 */
export function requireStaff(deps: {
  verifier: TokenVerifier;
  admin: AdminStore;
  tenants: TenantStore;
}): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
    const user = token ? await deps.verifier.verify(token) : null;
    if (!user) return apiError(c, 'unauthorized', 'Connexion requise');
    const memberships = await deps.admin.resolveStaff(user.userId, user.email);
    if (memberships.length === 0)
      return apiError(c, 'forbidden', "Ce compte n'a pas accès au back-office");

    const wanted = c.req.header('X-Tenant-Id') ?? null;
    const superAdmin = memberships.find((m) => m.role === 'super_admin');
    let staff: StaffUser;
    let tenantId: string | null;
    if (superAdmin) {
      staff = superAdmin;
      tenantId = wanted;
    } else {
      const m = memberships.find((x) => x.tenantId === wanted) ?? memberships[0];
      if (!m) return apiError(c, 'forbidden', 'Accès refusé');
      staff = m;
      tenantId = m.tenantId;
    }
    const tenant = tenantId ? await deps.tenants.findById(tenantId) : null;
    if (tenantId && !tenant) return apiError(c, 'not_found', 'Enseigne inconnue');
    c.set('admin', { staff, tenant });
    await next();
  };
}

/** Rôles autorisés pour une route ; l'enseigne doit être choisie pour les routes d'enseigne. */
export function allow(
  c: Context<AdminEnv>,
  roles: readonly StaffUser['role'][],
  needsTenant = true,
) {
  const { staff, tenant } = c.get('admin');
  if (!roles.includes(staff.role)) return apiError(c, 'forbidden', 'Droits insuffisants');
  if (needsTenant && !tenant) return apiError(c, 'invalid_request', 'Choisissez une enseigne');
  return null;
}

/** Un équipier ne voit que son restaurant. */
export function restaurantScope(ctx: AdminContext): string | undefined {
  return ctx.staff.role === 'staff' ? (ctx.staff.restaurantId ?? undefined) : undefined;
}
