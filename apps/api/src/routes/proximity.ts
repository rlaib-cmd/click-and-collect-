import type { LoyaltyProvider } from '@splash360/api-loyalty';
import {
  proximityDeviceSchema,
  proximityEnterSchema,
  proximityOpenedSchema,
  proximityOptOutSchema,
  type ProximityEnterResponse,
  type ProximityRegionsDto,
} from '@splash360/contracts';
import type {
  MemberSessionStore,
  OrderingStore,
  ProximityStore,
  RestaurantStore,
  TenantWithTheme,
} from '@splash360/db';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { apiError } from '../errors';
import { authenticateMember } from '../loyalty/service';
import type { NotificationSender } from '../notifications/sender';
import { handleProximityEnter } from '../proximity/service';
import { bearerMember } from './loyalty';

export interface ProximityRoutesDeps {
  /** Notifications à proximité (lot 22, ADR 0027) ; absent = fonction indisponible. */
  readonly proximity?: ProximityStore | undefined;
  readonly restaurants: RestaurantStore;
  readonly ordering: OrderingStore;
  readonly loyalty?: LoyaltyProvider | undefined;
  readonly notifier: NotificationSender;
  readonly tokenSecret: string;
  readonly memberSessions?: MemberSessionStore | undefined;
  readonly now: () => Date;
  readonly proximityLog?: (message: string, detail?: Record<string, unknown>) => void;
}

type Env = { Variables: { tenant: TenantWithTheme } };

async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/**
 * « Bons plans à proximité », montées sous /v1/tenants/:subdomain. Réservé aux membres du club
 * connectés (jeton de membre) ; aucune position n'est reçue, seulement un identifiant de restaurant.
 */
export function registerProximityRoutes(app: Hono<Env>, deps: ProximityRoutesDeps) {
  /** Magasin et membre authentifié, ou réponse d'erreur. */
  async function guard(c: Context<Env>) {
    const store = deps.proximity;
    if (!store || !deps.loyalty) return apiError(c, 'not_found', 'Route inconnue');
    const tenant = c.get('tenant');
    const memberId = await authenticateMember(deps, tenant.id, bearerMember(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    c.header('Cache-Control', 'no-store');
    return { store, tenant, memberId };
  }

  app.get('/:subdomain/proximity', async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const rules = await g.store.getSettings(g.tenant.id);
    const restaurants = rules.enabled
      ? (await deps.restaurants.listByTenant(g.tenant.id)).flatMap((r) =>
          r.status === 'active' && r.latitude !== null && r.longitude !== null
            ? [{ restaurantId: r.id, latitude: r.latitude, longitude: r.longitude }]
            : [],
        )
      : [];
    const body: ProximityRegionsDto = {
      enabled: rules.enabled,
      radiusMeters: rules.radiusMeters,
      restaurants,
    };
    return c.json(body);
  });

  app.put('/:subdomain/proximity/device', async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const input = await readJson(c, proximityDeviceSchema);
    if (!input) return apiError(c, 'invalid_request', 'Appareil invalide');
    await g.store.registerDevice(g.tenant.id, g.memberId, input.token, input.platform);
    return c.body(null, 204);
  });

  // Retrait de l'accord : l'appareil (ou tous ceux du membre) est effacé côté serveur.
  app.post('/:subdomain/proximity/opt-out', async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const input = await readJson(c, proximityOptOutSchema);
    if (!input) return apiError(c, 'invalid_request', 'Demande invalide');
    await g.store.removeDevices(g.tenant.id, g.memberId, input.token);
    return c.body(null, 204);
  });

  app.post('/:subdomain/proximity/enter', async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const input = await readJson(c, proximityEnterSchema);
    if (!input) return apiError(c, 'invalid_request', 'Restaurant invalide');
    const outcome = await handleProximityEnter(
      {
        proximity: g.store,
        restaurants: deps.restaurants,
        ordering: deps.ordering,
        loyalty: deps.loyalty,
        notifier: deps.notifier,
        now: deps.now,
        ...(deps.proximityLog ? { log: deps.proximityLog } : {}),
      },
      { id: g.tenant.id, splash360Id: g.tenant.splash360Id },
      g.memberId,
      input.restaurantId,
    );
    if (outcome.status === 'unknown_restaurant')
      return apiError(c, 'not_found', 'Restaurant inconnu');
    const body: ProximityEnterResponse = { notified: outcome.notified };
    return c.json(body, 202);
  });

  app.post('/:subdomain/proximity/opened', async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const input = await readJson(c, proximityOpenedSchema);
    if (!input) return apiError(c, 'invalid_request', 'Notification invalide');
    // Réponse identique que la notification soit connue ou non (pas de sonde d'identifiants).
    await g.store.markOpened(g.tenant.id, g.memberId, input.eventId, deps.now());
    return c.body(null, 204);
  });
}
