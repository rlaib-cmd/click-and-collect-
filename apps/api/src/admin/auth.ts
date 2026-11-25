import { can, isRestaurantScoped, type Permission } from '@splash360/core';
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
  // Comptes du back-office gardés 30 s par copie du serveur : un onglet qui recharge en boucle
  // ne relit pas la base à chaque requête pour savoir qui il est.
  const cache = new Map<string, { at: number; value: StaffUser[] }>();
  const tenants = new Map<string, { at: number; value: TenantWithTheme | null }>();
  const cachedTenant = async (id: string) => {
    const hit = tenants.get(id);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const value = await deps.tenants.findById(id);
    if (tenants.size > 1000) tenants.clear();
    tenants.set(id, { at: Date.now(), value });
    return value;
  };
  return async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
    const user = token ? await deps.verifier.verify(token) : null;
    if (!user) return apiError(c, 'unauthorized', 'Connexion requise');
    const now = Date.now();
    const hit = cache.get(user.userId);
    let memberships: StaffUser[];
    if (hit && now - hit.at < 30_000) {
      memberships = hit.value;
    } else {
      memberships = [...(await deps.admin.resolveStaff(user.userId, user.email))];
      if (cache.size > 1000) cache.clear();
      cache.set(user.userId, { at: now, value: memberships });
    }
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
    const tenant = tenantId ? await cachedTenant(tenantId) : null;
    if (tenantId && !tenant) return apiError(c, 'not_found', 'Enseigne inconnue');
    c.set('admin', { staff, tenant });
    await next();
  };
}

/**
 * Droit requis pour une route (ADR 0017, `can` de @splash360/core) ; l'enseigne doit être
 * choisie pour les routes d'enseigne.
 */
export function allow(c: Context<AdminEnv>, permission: Permission, needsTenant = true) {
  const { staff, tenant } = c.get('admin');
  if (!can(staff.role, permission)) return apiError(c, 'forbidden', 'Droits insuffisants');
  if (needsTenant && !tenant) return apiError(c, 'invalid_request', 'Choisissez une enseigne');
  return null;
}

/** Un équipier ne voit que son restaurant. */
export function restaurantScope(ctx: AdminContext): string | undefined {
  return isRestaurantScoped(ctx.staff.role) ? (ctx.staff.restaurantId ?? undefined) : undefined;
}

/**
 * Lectures identiques du back-office servies depuis la mémoire pendant `ttlMs` (par utilisateur,
 * enseigne et URL) : un onglet qui recharge en boucle ne touche plus la base. Toute écriture
 * (POST, PUT, PATCH, DELETE) vide le cache de l'instance, la relecture suivante est fraîche.
 */
export function shortReadCache(ttlMs = 2000): MiddlewareHandler<AdminEnv> {
  const entries = new Map<string, { at: number; status: number; body: string; type: string }>();
  return async (c, next) => {
    if (c.req.method !== 'GET') {
      entries.clear();
      await next();
      return;
    }
    const { staff, tenant } = c.get('admin');
    const key = `${staff.id}\n${tenant?.id ?? ''}\n${c.req.url}`;
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) {
      return c.body(hit.body, hit.status as 200, { 'Content-Type': hit.type });
    }
    await next();
    const type = c.res.headers.get('Content-Type') ?? '';
    if (c.res.status === 200 && type.includes('application/json')) {
      if (entries.size > 2000) entries.clear();
      entries.set(key, { at: now, status: 200, body: await c.res.clone().text(), type });
    }
  };
}
