import type { Sql } from './client';

export type RestaurantStatus = 'active' | 'paused' | 'closed';

export interface Restaurant {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly splash360Id: string;
  readonly addressLine: string;
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly stripeAccountId: string | null;
  /** Le compte Stripe connecté peut encaisser (webhook account.updated). */
  readonly stripeChargesEnabled: boolean;
  readonly status: RestaurantStatus;
  /** Branché sur la vraie carte et la vraie caisse Splash360 (ADR 0018) ; sinon démonstration. */
  readonly splash360Live: boolean;
  /**
   * Station click and collect Splash360 (identifiant client, dernier segment du chemin des
   * webhooks, lot 23) ; null ou absent : non réglée.
   */
  readonly splash360StationId?: string | null;
}

/** Format accepté pour l'identifiant de station (contrainte de la base). */
export const SPLASH360_STATION_ID = /^[A-Za-z0-9_.-]{1,100}$/;

/** Toutes les méthodes exigent l'enseigne : impossible de lire le restaurant d'une autre. */
export interface RestaurantStore {
  listByTenant(tenantId: string): Promise<Restaurant[]>;
  findById(tenantId: string, restaurantId: string): Promise<Restaurant | null>;
  setStripeAccount(tenantId: string, restaurantId: string, accountId: string): Promise<void>;
  /**
   * Branche ou débranche la caisse et la carte réelles Splash360 ; faux si restaurant inconnu,
   * ou si un autre restaurant est déjà branché : Splash360 donne un accès par restaurant et le
   * serveur n'en porte qu'un (ADR 0018).
   */
  setSplash360Live(tenantId: string, restaurantId: string, live: boolean): Promise<boolean>;
  /** Restaurant d'une station Splash360 (webhooks, lot 23), toutes enseignes confondues. */
  findBySplash360Station(stationId: string): Promise<Restaurant | null>;
  /** Règle la station du restaurant ; « taken » si un autre restaurant l'a déjà. */
  setSplash360Station(
    tenantId: string,
    restaurantId: string,
    stationId: string | null,
  ): Promise<'ok' | 'not_found' | 'taken'>;
}

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  splash360_id: string;
  address_line: string;
  postal_code: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  status: RestaurantStatus;
  splash360_live: boolean;
  splash360_station_id: string | null;
}

function toRestaurant(r: Row): Restaurant {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    splash360Id: r.splash360_id,
    addressLine: r.address_line,
    postalCode: r.postal_code,
    city: r.city,
    latitude: r.latitude,
    longitude: r.longitude,
    stripeAccountId: r.stripe_account_id,
    stripeChargesEnabled: r.stripe_charges_enabled,
    status: r.status,
    splash360Live: r.splash360_live,
    splash360StationId: r.splash360_station_id,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresRestaurantStore(sql: Sql): RestaurantStore {
  return {
    async listByTenant(tenantId) {
      const rows = await sql<Row[]>`
        select * from public.restaurants
        where tenant_id = ${tenantId} and status <> 'closed'
        order by name`;
      return rows.map(toRestaurant);
    },
    async findById(tenantId, restaurantId) {
      if (!UUID.test(restaurantId)) return null;
      const rows = await sql<Row[]>`
        select * from public.restaurants
        where tenant_id = ${tenantId} and id = ${restaurantId}
        limit 1`;
      return rows[0] ? toRestaurant(rows[0]) : null;
    },
    async setStripeAccount(tenantId, restaurantId, accountId) {
      await sql`update public.restaurants set stripe_account_id = ${accountId}
                where tenant_id = ${tenantId} and id = ${restaurantId} and stripe_account_id is null`;
    },
    async setSplash360Live(tenantId, restaurantId, live) {
      if (!UUID.test(restaurantId)) return false;
      const rows = await sql`update public.restaurants set splash360_live = ${live}
                where tenant_id = ${tenantId} and id = ${restaurantId}
                  and (not ${live} or not exists (
                    select 1 from public.restaurants o
                    where o.splash360_live and o.id <> ${restaurantId}))
                returning id`;
      return rows.length > 0;
    },
    async findBySplash360Station(stationId) {
      if (!SPLASH360_STATION_ID.test(stationId)) return null;
      const rows = await sql<Row[]>`
        select * from public.restaurants where splash360_station_id = ${stationId} limit 1`;
      return rows[0] ? toRestaurant(rows[0]) : null;
    },
    async setSplash360Station(tenantId, restaurantId, stationId) {
      if (!UUID.test(restaurantId)) return 'not_found';
      if (stationId !== null && !SPLASH360_STATION_ID.test(stationId)) return 'not_found';
      try {
        const rows = await sql`update public.restaurants set splash360_station_id = ${stationId}
                  where tenant_id = ${tenantId} and id = ${restaurantId} returning id`;
        return rows.length > 0 ? 'ok' : 'not_found';
      } catch (error) {
        // Index unique : la station est déjà rattachée à un autre restaurant.
        if ((error as { code?: string }).code === '23505') return 'taken';
        throw error;
      }
    },
  };
}

export function createMemoryRestaurantStore(source: readonly Restaurant[]): RestaurantStore {
  // Copie : les tests ne partagent pas d'état entre eux.
  const restaurants = source.map((r) => ({ ...r }));
  return {
    listByTenant: (tenantId) =>
      Promise.resolve(
        restaurants
          .filter((r) => r.tenantId === tenantId && r.status !== 'closed')
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    findById: (tenantId, restaurantId) =>
      Promise.resolve(
        restaurants.find((r) => r.tenantId === tenantId && r.id === restaurantId) ?? null,
      ),
    setStripeAccount(tenantId, restaurantId, accountId) {
      const r = restaurants.find((x) => x.tenantId === tenantId && x.id === restaurantId);
      if (r && !r.stripeAccountId) Object.assign(r, { stripeAccountId: accountId });
      return Promise.resolve();
    },
    setSplash360Live(tenantId, restaurantId, live) {
      const r = restaurants.find((x) => x.tenantId === tenantId && x.id === restaurantId);
      const other = restaurants.some((x) => x.splash360Live && x.id !== restaurantId);
      if (!r || (live && other)) return Promise.resolve(false);
      Object.assign(r, { splash360Live: live });
      return Promise.resolve(true);
    },
    findBySplash360Station(stationId) {
      return Promise.resolve(restaurants.find((r) => r.splash360StationId === stationId) ?? null);
    },
    setSplash360Station(tenantId, restaurantId, stationId) {
      const r = restaurants.find((x) => x.tenantId === tenantId && x.id === restaurantId);
      if (!r) return Promise.resolve('not_found' as const);
      if (
        stationId !== null &&
        restaurants.some((x) => x.id !== restaurantId && x.splash360StationId === stationId)
      )
        return Promise.resolve('taken' as const);
      Object.assign(r, { splash360StationId: stationId });
      return Promise.resolve('ok' as const);
    },
  };
}
