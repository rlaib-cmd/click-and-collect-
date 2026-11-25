import type { Sql } from './client';

export interface PayableOrder {
  readonly id: string;
  readonly tenantId: string;
  readonly restaurantId: string;
  readonly number: number;
  readonly status: string;
  readonly totalCents: number;
  readonly applicationFeeCents: number;
  readonly refundedCents: number;
  readonly paymentIntentId: string | null;
  readonly stripeAccountId: string | null;
  readonly stripeChargesEnabled: boolean;
  readonly accessTokenHash: string | null;
}

export type PaymentTransition =
  | {
      readonly ok: true;
      readonly orderId: string;
      readonly tenantId: string;
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly error: 'unknown_payment' | 'amount_mismatch' };

export interface ExpiredOrder {
  readonly orderId: string;
  readonly tenantId: string;
  readonly paymentIntentId: string | null;
  readonly stripeAccountId: string | null;
}

export type RefundResult =
  | { readonly ok: true; readonly refundedCents: number; readonly fullyRefunded: boolean }
  | { readonly ok: false; readonly error: 'not_refundable' | 'amount_too_high' };

export interface PaymentStore {
  getOrder(tenantId: string, orderId: string): Promise<PayableOrder | null>;
  /** Associe le PaymentIntent à une commande encore en attente de paiement. */
  attachPaymentIntent(tenantId: string, orderId: string, paymentIntentId: string): Promise<boolean>;
  /** Webhook payment_intent.succeeded. Idempotent : `changed` est faux si déjà traité. */
  markPaid(
    paymentIntentId: string,
    amountCents: number,
    currency: string,
  ): Promise<PaymentTransition>;
  /** Webhook payment_intent.payment_failed. */
  markPaymentFailed(paymentIntentId: string): Promise<PaymentTransition>;
  /** Commandes en attente de paiement depuis avant `olderThan` : annulées, créneau libéré. */
  expirePending(olderThan: Date): Promise<ExpiredOrder[]>;
  /**
   * Remboursement total ou partiel, tracé dans l'historique. Idempotent par `requestId` : une
   * demande déjà enregistrée (double clic, nouvel essai) n'est pas comptée deux fois.
   */
  recordRefund(
    tenantId: string,
    orderId: string,
    amountCents: number,
    actor: string,
    requestId: string,
  ): Promise<RefundResult>;
  /** Cette demande de remboursement a-t-elle déjà été enregistrée ? */
  hasRefundRequest(tenantId: string, orderId: string, requestId: string): Promise<boolean>;
  /** Webhook account.updated. */
  setChargesEnabled(stripeAccountId: string, enabled: boolean): Promise<void>;
  /** Points crédités et récompense consommée chez Splash360 (lot 8). */
  markLoyaltySettled(tenantId: string, orderId: string): Promise<void>;
}

interface OrderRow {
  id: string;
  tenant_id: string;
  restaurant_id: string;
  number: number;
  status: string;
  total_cents: number;
  application_fee_cents: number;
  refunded_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  access_token_hash: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuts après paiement : un remboursement y est possible. */
const PAID_STATUSES = ['paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];

export function createPostgresPaymentStore(sql: Sql): PaymentStore {
  return {
    async getOrder(tenantId, orderId) {
      if (!UUID.test(orderId)) return null;
      const [r] = await sql<OrderRow[]>`
        select o.id, o.tenant_id, o.restaurant_id, o.number, o.status, o.total_cents, o.application_fee_cents,
               o.refunded_cents, o.stripe_payment_intent_id, o.access_token_hash,
               r.stripe_account_id, r.stripe_charges_enabled
        from public.orders o join public.restaurants r on r.id = o.restaurant_id
        where o.tenant_id = ${tenantId} and o.id = ${orderId}`;
      if (!r) return null;
      return {
        id: r.id,
        tenantId: r.tenant_id,
        restaurantId: r.restaurant_id,
        number: r.number,
        status: r.status,
        totalCents: r.total_cents,
        applicationFeeCents: r.application_fee_cents,
        refundedCents: r.refunded_cents,
        paymentIntentId: r.stripe_payment_intent_id,
        stripeAccountId: r.stripe_account_id,
        stripeChargesEnabled: r.stripe_charges_enabled,
        accessTokenHash: r.access_token_hash,
      };
    },

    async attachPaymentIntent(tenantId, orderId, paymentIntentId) {
      const rows = await sql`
        update public.orders set stripe_payment_intent_id = ${paymentIntentId}
        where tenant_id = ${tenantId} and id = ${orderId}
          and status in ('pending_payment', 'payment_failed')
          and (stripe_payment_intent_id is null or stripe_payment_intent_id = ${paymentIntentId})`;
      return rows.count === 1;
    },

    async markPaid(paymentIntentId, amountCents, currency) {
      return sql.begin(async (tx) => {
        const [o] = await tx<
          { id: string; tenant_id: string; status: string; total_cents: number; currency: string }[]
        >`
          select id, tenant_id, status, total_cents, currency from public.orders
          where stripe_payment_intent_id = ${paymentIntentId} for update`;
        if (!o) return { ok: false as const, error: 'unknown_payment' as const };
        // Défense en profondeur : le montant encaissé doit être exactement celui de la commande.
        if (o.total_cents !== amountCents || o.currency.toLowerCase() !== currency.toLowerCase()) {
          return { ok: false as const, error: 'amount_mismatch' as const };
        }
        // Un paiement réussi rattrape une commande expirée entre-temps (le client a bien payé), mais
        // jamais une commande annulée par l'équipe ou la caisse : elle ne redevient pas « payée »
        // si Stripe renvoie l'avis plus tard (audit du 25/11).
        let catchUp = ['pending_payment', 'payment_failed'].includes(o.status);
        if (o.status === 'cancelled') {
          const [last] = await tx<{ actor: string; reason: string | null }[]>`
            select actor, detail->>'reason' as reason from public.order_events
            where order_id = ${o.id} and status = 'cancelled' order by created_at desc limit 1`;
          catchUp = last?.actor === 'system' && last.reason === 'payment_timeout';
        }
        if (!catchUp) {
          return { ok: true as const, orderId: o.id, tenantId: o.tenant_id, changed: false };
        }
        await tx`update public.orders set status = 'paid', paid_at = now() where id = ${o.id}`;
        // File d'envoi vers la caisse, dans la même transaction : une commande payée n'est jamais oubliée.
        await tx`insert into public.pos_dispatches (order_id, tenant_id) values (${o.id}, ${o.tenant_id})
                 on conflict (order_id) do nothing`;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor, detail)
                 values (${o.tenant_id}, ${o.id}, 'paid', 'stripe', ${tx.json({ paymentIntentId, previous: o.status })})`;
        return { ok: true as const, orderId: o.id, tenantId: o.tenant_id, changed: true };
      });
    },

    async markPaymentFailed(paymentIntentId) {
      return sql.begin(async (tx) => {
        const [o] = await tx<{ id: string; tenant_id: string; status: string }[]>`
          select id, tenant_id, status from public.orders where stripe_payment_intent_id = ${paymentIntentId} for update`;
        if (!o) return { ok: false as const, error: 'unknown_payment' as const };
        if (o.status !== 'pending_payment')
          return { ok: true as const, orderId: o.id, tenantId: o.tenant_id, changed: false };
        await tx`update public.orders set status = 'payment_failed' where id = ${o.id}`;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor) values (${o.tenant_id}, ${o.id}, 'payment_failed', 'stripe')`;
        return { ok: true as const, orderId: o.id, tenantId: o.tenant_id, changed: true };
      });
    },

    async expirePending(olderThan) {
      return sql.begin(async (tx) => {
        const rows = await tx<
          {
            id: string;
            tenant_id: string;
            stripe_payment_intent_id: string | null;
            stripe_account_id: string | null;
          }[]
        >`
          update public.orders o set status = 'cancelled'
          from public.restaurants r
          where r.id = o.restaurant_id
            and o.status in ('pending_payment', 'payment_failed') and o.created_at < ${olderThan}
          returning o.id, o.tenant_id, o.stripe_payment_intent_id, r.stripe_account_id`;
        for (const r of rows) {
          await tx`insert into public.order_events (tenant_id, order_id, status, actor, detail)
                   values (${r.tenant_id}, ${r.id}, 'cancelled', 'system', ${tx.json({ reason: 'payment_timeout' })})`;
        }
        return rows.map((r) => ({
          orderId: r.id,
          tenantId: r.tenant_id,
          paymentIntentId: r.stripe_payment_intent_id,
          stripeAccountId: r.stripe_account_id,
        }));
      });
    },

    async hasRefundRequest(tenantId, orderId, requestId) {
      const rows = await sql`
        select 1 from public.order_events
        where tenant_id = ${tenantId} and order_id = ${orderId}
          and status in ('refunded', 'partially_refunded') and detail->>'requestId' = ${requestId}
        limit 1`;
      return rows.length > 0;
    },

    async recordRefund(tenantId, orderId, amountCents, actor, requestId) {
      return sql.begin(async (tx) => {
        const [o] = await tx<{ status: string; total_cents: number; refunded_cents: number }[]>`
          select status, total_cents, refunded_cents from public.orders
          where tenant_id = ${tenantId} and id = ${orderId} for update`;
        // Même demande déjà enregistrée (sous le verrou de la commande) : rien à ajouter.
        const seen = await tx`
          select 1 from public.order_events
          where tenant_id = ${tenantId} and order_id = ${orderId}
            and status in ('refunded', 'partially_refunded') and detail->>'requestId' = ${requestId}
          limit 1`;
        if (o && seen.length > 0)
          return {
            ok: true as const,
            refundedCents: o.refunded_cents,
            fullyRefunded: o.refunded_cents === o.total_cents,
          };
        if (!o || !PAID_STATUSES.includes(o.status))
          return { ok: false as const, error: 'not_refundable' as const };
        if (
          !Number.isSafeInteger(amountCents) ||
          amountCents <= 0 ||
          o.refunded_cents + amountCents > o.total_cents
        ) {
          return { ok: false as const, error: 'amount_too_high' as const };
        }
        const refunded = o.refunded_cents + amountCents;
        const full = refunded === o.total_cents;
        await tx`update public.orders set refunded_cents = ${refunded}, status = ${full ? 'refunded' : o.status}
                 where id = ${orderId}`;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor, detail)
                 values (${tenantId}, ${orderId}, ${full ? 'refunded' : 'partially_refunded'}, ${actor},
                         ${tx.json({ amountCents, requestId })})`;
        return { ok: true as const, refundedCents: refunded, fullyRefunded: full };
      });
    },

    async setChargesEnabled(stripeAccountId, enabled) {
      await sql`update public.restaurants set stripe_charges_enabled = ${enabled} where stripe_account_id = ${stripeAccountId}`;
    },
    async markLoyaltySettled(tenantId, orderId) {
      await sql`update public.orders set loyalty_settled_at = coalesce(loyalty_settled_at, now())
                where tenant_id = ${tenantId} and id = ${orderId}`;
    },
  };
}
