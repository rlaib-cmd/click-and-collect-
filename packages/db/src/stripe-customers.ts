import type { Sql } from './client';

/**
 * Client Stripe de la plateforme par membre du club et par enseigne (lot 18, ADR 0023).
 * Seul l'identifiant `cus_…` est conservé ; les cartes restent chez Stripe.
 */
export interface StripeCustomerStore {
  find(tenantId: string, memberId: string): Promise<string | null>;
  /** Enregistre le client ; en cas de course, renvoie celui déjà enregistré. */
  save(tenantId: string, memberId: string, stripeCustomerId: string): Promise<string>;
}

export function createPostgresStripeCustomerStore(sql: Sql): StripeCustomerStore {
  return {
    async find(tenantId, memberId) {
      const [r] = await sql<{ stripe_customer_id: string }[]>`
        select stripe_customer_id from public.stripe_customers
        where tenant_id = ${tenantId} and member_id = ${memberId}`;
      return r?.stripe_customer_id ?? null;
    },
    async save(tenantId, memberId, stripeCustomerId) {
      await sql`
        insert into public.stripe_customers (tenant_id, member_id, stripe_customer_id)
        values (${tenantId}, ${memberId}, ${stripeCustomerId})
        on conflict (tenant_id, member_id) do nothing`;
      const [r] = await sql<{ stripe_customer_id: string }[]>`
        select stripe_customer_id from public.stripe_customers
        where tenant_id = ${tenantId} and member_id = ${memberId}`;
      return r?.stripe_customer_id ?? stripeCustomerId;
    },
  };
}

export function createMemoryStripeCustomerStore(): StripeCustomerStore {
  const ids = new Map<string, string>();
  return {
    find: (tenantId, memberId) => Promise.resolve(ids.get(`${tenantId}:${memberId}`) ?? null),
    save(tenantId, memberId, stripeCustomerId) {
      const key = `${tenantId}:${memberId}`;
      if (!ids.has(key)) ids.set(key, stripeCustomerId);
      return Promise.resolve(ids.get(key) ?? stripeCustomerId);
    },
  };
}
