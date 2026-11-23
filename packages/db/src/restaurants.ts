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
}

/** Toutes les méthodes exigent l'enseigne : impossible de lire le restaurant d'une autre. */
export interface RestaurantStore {
  listByTenant(tenantId: string): Promise<Restaurant[]>;
  findById(tenantId: string, restaurantId: string): Promise<Restaurant | null>;
  setStripeAccount(tenantId: string, restaurantId: string, accountId: string): Promise<void>;
  /** Branche ou débranche la caisse et la carte réelles Splash360 ; faux si restaurant inconnu. */
  setSplash360Live(tenantId: string, restaurantId: string, live: boolean): Promise<boolean>;
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
                where tenant_id = ${tenantId} and id = ${restaurantId} returning id`;
      return rows.length > 0;
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
      if (r) Object.assign(r, { splash360Live: live });
      return Promise.resolve(Boolean(r));
    },
  };
}
