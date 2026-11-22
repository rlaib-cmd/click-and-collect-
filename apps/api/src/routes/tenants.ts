import { MenuUnavailableError, type MenuCache } from '@splash360/api-menu';
import { subdomainSchema, type RestaurantDto, type TenantConfig } from '@splash360/contracts';
import type {
  AdminStore,
  Restaurant,
  RestaurantStore,
  TenantStore,
  TenantWithTheme,
} from '@splash360/db';
import { DEFAULT_THEME } from '@splash360/theme';
import { Hono } from 'hono';
import { apiError } from '../errors';
import { toMenuDto } from '../menu-dto';
import { registerOrderingRoutes, type OrderingRoutesDeps } from './ordering';
import { registerPaymentRoutes, type PaymentRoutesDeps } from './payments';

export interface TenantRoutesDeps extends OrderingRoutesDeps, PaymentRoutesDeps {
  readonly admin: AdminStore;
  readonly tenants: TenantStore;
  readonly restaurants: RestaurantStore;
  readonly menus: MenuCache;
}

type Env = { Variables: { tenant: TenantWithTheme } };

function toRestaurantDto(r: Restaurant): RestaurantDto {
  return {
    id: r.id,
    name: r.name,
    addressLine: r.addressLine,
    postalCode: r.postalCode,
    city: r.city,
    status: r.status === 'paused' ? 'paused' : 'active',
  };
}

/**
 * Routes publiques de l'application client, toutes rattachées à une enseigne active
 * (ADR 0002 et 0004). Un restaurant n'est jamais lu en dehors de son enseigne.
 */
export function tenantRoutes(deps: TenantRoutesDeps) {
  const app = new Hono<Env>();

  app.use('/:subdomain/*', async (c, next) => {
    const parsed = subdomainSchema.safeParse(c.req.param('subdomain'));
    if (!parsed.success) return apiError(c, 'invalid_request', 'Sous-domaine invalide');
    const tenant = await deps.tenants.findBySubdomain(parsed.data);
    if (!tenant) return apiError(c, 'not_found', 'Enseigne inconnue');
    if (tenant.status !== 'active') return apiError(c, 'tenant_suspended', 'Enseigne suspendue');
    c.set('tenant', tenant);
    await next();
  });

  app.get('/:subdomain/config', (c) => {
    const tenant = c.get('tenant');
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

  app.get('/:subdomain/restaurants', async (c) => {
    const list = await deps.restaurants.listByTenant(c.get('tenant').id);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ restaurants: list.map(toRestaurantDto) });
  });

  app.get('/:subdomain/restaurants/:restaurantId/menu', async (c) => {
    const restaurant = await deps.restaurants.findById(
      c.get('tenant').id,
      c.req.param('restaurantId'),
    );
    if (!restaurant || restaurant.status === 'closed') {
      return apiError(c, 'not_found', 'Restaurant inconnu');
    }
    try {
      const cached = await deps.menus.get({
        restaurantId: restaurant.id,
        splash360RestaurantId: restaurant.splash360Id,
      });
      const overrides = await deps.admin.listMenuOverrides(c.get('tenant').id, restaurant.id);
      c.header('Cache-Control', 'public, max-age=30');
      return c.json(
        toMenuDto(cached.menu, restaurant.id, cached.fetchedAt, cached.stale, overrides),
      );
    } catch (error) {
      if (error instanceof MenuUnavailableError) {
        return apiError(c, 'menu_unavailable', 'Carte momentanément indisponible');
      }
      throw error;
    }
  });

  app.get('/:subdomain/legal', async (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ text: await deps.admin.getLegalText(c.get('tenant').id) });
  });

  registerOrderingRoutes(app, deps);
  registerPaymentRoutes(app, deps);

  return app;
}
