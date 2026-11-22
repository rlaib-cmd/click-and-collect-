import { subdomainSchema, type TenantConfig } from '@splash360/contracts';
import type { TenantStore } from '@splash360/db';
import { DEFAULT_THEME } from '@splash360/theme';
import { Hono } from 'hono';
import { apiError } from '../errors';

/** Configuration publique d'une enseigne, chargée par l'application au démarrage (ADR 0004). */
export function tenantRoutes(store: TenantStore) {
  return new Hono().get('/:subdomain/config', async (c) => {
    const parsed = subdomainSchema.safeParse(c.req.param('subdomain'));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Sous-domaine invalide');

    const tenant = await store.findBySubdomain(parsed.data);
    if (!tenant) return apiError(c, 'not_found', 'Enseigne inconnue');
    if (tenant.status !== 'active') return apiError(c, 'tenant_suspended', 'Enseigne suspendue');

    const theme = tenant.theme ?? DEFAULT_THEME;
    const body: TenantConfig = {
      tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain },
      theme: {
        primaryColor: theme.primaryColor,
        mode: theme.mode,
        logoUrl: theme.logoUrl,
        tagline: theme.tagline,
      },
    };
    // Données publiques : cache court côté client et CDN, rafraîchi en arrière-plan.
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return c.json(body);
  });
}
