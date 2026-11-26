import {
  checkTransition,
  type OperationalStatus,
  type OrderMode,
  type OrderStatus,
} from '@splash360/core';
import type { Sql } from './client';

export interface DueDispatch {
  readonly orderId: string;
  readonly tenantId: string;
  readonly attempts: number;
}

export type StatusChange =
  | {
      readonly ok: true;
      readonly from: OrderStatus;
      readonly to: OperationalStatus;
      readonly tenantId: string;
      readonly orderId: string;
    }
  | {
      readonly ok: false;
      readonly error: 'not_found' | 'not_paid' | 'finished' | 'backwards' | 'invalid_for_mode';
    };

export interface FailedDispatch {
  readonly orderId: string;
  readonly number: number;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

/**
 * Commande annulée de notre côté (paiement non terminé, caisse pas prête, dépôt incertain) alors
 * que la caisse a pu la recevoir : elle y reste « en attente » (standby), et seule la caisse peut
 * l'annuler (Splash360, 26/11). Alerte du back-office pendant 24 h.
 */
export interface PosOrderToCancel {
  readonly orderId: string;
  readonly number: number;
  readonly cancelledAt: string;
}

export interface PosTicketOrder {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly paymentMethod: 'online' | 'on_site';
}

/** Événements de l'historique posés par les webhooks Splash360 (lot 23). */
export type PosEventStatus = 'pos_paid' | 'pos_cancelled';
export interface PosEventDetail {
  readonly reason: string | null;
  readonly occurredAt: string | null;
  readonly amountCents: number | null;
}
/** Auteur des événements venus de la caisse par webhook. */
export const POS_WEBHOOK_ACTOR = 'caisse';

/** Opérations après paiement : envoi à la caisse, statuts, jetons de notification. */
export interface OperationsStore {
  /** Réserve les envois dus (bail de 2 min pour qu'une autre instance ne les prenne pas en même temps). */
  claimDueDispatches(limit: number): Promise<DueDispatch[]>;
  markDispatched(orderId: string, externalReference: string): Promise<void>;
  /** `retryAt` null : abandon définitif, l'alerte apparaît au back-office. */
  markDispatchFailed(orderId: string, error: string, retryAt: Date | null): Promise<void>;
  /** `restaurantId` : envois d'un seul restaurant (équipier, audit du 25/11 M5). */
  listFailedDispatches(tenantId: string, restaurantId?: string): Promise<FailedDispatch[]>;
  /** Commandes annulées ici mais peut-être « en attente » en caisse (24 dernières heures). */
  listPosToCancel(tenantId: string, restaurantId?: string): Promise<PosOrderToCancel[]>;
  /**
   * Relance manuelle depuis le back-office. Jamais pour une commande annulée ou remboursée
   * (elle serait préparée alors que le client est remboursé, audit M5). Libère un dépôt en caisse
   * abandonné sans ticket : l'équipe a vérifié que la caisse ne l'a pas reçu.
   */
  retryDispatch(tenantId: string, orderId: string, restaurantId?: string): Promise<boolean>;
  /** Changement de statut contrôlé par la machine à états de `core`, tracé avec son auteur. */
  changeStatus(
    tenantId: string,
    orderId: string,
    to: OperationalStatus,
    actor: string,
  ): Promise<StatusChange>;
  findByPosReference(posReference: string): Promise<{ tenantId: string; orderId: string } | null>;
  /**
   * Commande du restaurant par sa référence Splash360 (ticket reçu au dépôt, `pos_ticket_id`) :
   * webhook d'encaissement / annulation (lot 23).
   */
  findByPosTicket(
    tenantId: string,
    restaurantId: string,
    ticketId: string,
  ): Promise<PosTicketOrder | null>;
  /**
   * Trace un encaissement ou une annulation reçus de la caisse (auteur « caisse »), une seule fois
   * par commande et par statut ; faux si déjà tracé.
   */
  recordPosEvent(
    tenantId: string,
    orderId: string,
    status: PosEventStatus,
    detail: PosEventDetail,
  ): Promise<boolean>;
  addPushToken(tenantId: string, orderId: string, token: string): Promise<void>;
  listPushTokens(tenantId: string, orderId: string): Promise<string[]>;
}

export function createPostgresOperationsStore(sql: Sql): OperationsStore {
  return {
    async claimDueDispatches(limit) {
      return sql<DueDispatch[]>`
        update public.pos_dispatches d
        set attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes'
        where d.order_id in (
          select order_id from public.pos_dispatches
          where status = 'pending' and next_attempt_at <= now()
          order by next_attempt_at
          limit ${limit}
          for update skip locked
        )
        returning d.order_id as "orderId", d.tenant_id as "tenantId", d.attempts`;
    },

    async markDispatched(orderId, externalReference) {
      await sql.begin(async (tx) => {
        await tx`update public.pos_dispatches set status = 'sent', external_reference = ${externalReference}, last_error = null
                 where order_id = ${orderId}`;
        await tx`update public.orders set pos_reference = ${externalReference} where id = ${orderId}`;
      });
    },

    async markDispatchFailed(orderId, error, retryAt) {
      await sql`
        update public.pos_dispatches
        set last_error = ${error.slice(0, 500)},
            status = ${retryAt ? 'pending' : 'failed'},
            next_attempt_at = coalesce(${retryAt}, next_attempt_at)
        where order_id = ${orderId}`;
    },

    async listFailedDispatches(tenantId, restaurantId) {
      const rows = await sql<
        {
          order_id: string;
          number: number;
          attempts: number;
          last_error: string | null;
          updated_at: Date;
        }[]
      >`
        select d.order_id, o.number, d.attempts, d.last_error, d.updated_at
        from public.pos_dispatches d join public.orders o on o.id = d.order_id
        where d.tenant_id = ${tenantId} and d.status = 'failed'
          ${restaurantId ? sql`and o.restaurant_id = ${restaurantId}` : sql``}
        order by d.updated_at desc`;
      return rows.map((r) => ({
        orderId: r.order_id,
        number: r.number,
        attempts: r.attempts,
        lastError: r.last_error,
        updatedAt: r.updated_at.toISOString(),
      }));
    },

    async listPosToCancel(tenantId, restaurantId) {
      const rows = await sql<{ id: string; number: number; updated_at: Date }[]>`
        select o.id, o.number, o.updated_at from public.orders o
        where o.tenant_id = ${tenantId} and o.status = 'cancelled'
          and o.updated_at > now() - interval '24 hours'
          and ((o.pos_ticket_id is not null and o.pos_payment_sent_at is null)
               or (o.pos_ticket_id is null and o.pos_opening_at is not null))
          ${restaurantId ? sql`and o.restaurant_id = ${restaurantId}` : sql``}
        order by o.updated_at desc limit 50`;
      return rows.map((r) => ({
        orderId: r.id,
        number: r.number,
        cancelledAt: r.updated_at.toISOString(),
      }));
    },

    async retryDispatch(tenantId, orderId, restaurantId) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          update public.pos_dispatches d set status = 'pending', next_attempt_at = now(), attempts = 0
          from public.orders o
          where d.tenant_id = ${tenantId} and d.order_id = ${orderId} and d.status = 'failed'
            and o.id = d.order_id and o.status not in ('cancelled', 'refunded')
            ${restaurantId ? sql`and o.restaurant_id = ${restaurantId}` : sql``}`;
        if (rows.count !== 1) return false;
        // Relance décidée par l'équipe (après vérification en caisse) : un dépôt abandonné sans
        // ticket peut être refait, une seule fois de plus.
        await tx`
          update public.orders set pos_opening_at = null
          where tenant_id = ${tenantId} and id = ${orderId} and pos_ticket_id is null`;
        return true;
      });
    },

    async changeStatus(tenantId, orderId, to, actor) {
      return sql.begin(async (tx) => {
        const [o] = await tx<{ status: OrderStatus; mode: OrderMode }[]>`
          select status, mode from public.orders where tenant_id = ${tenantId} and id = ${orderId} for update`;
        if (!o) return { ok: false as const, error: 'not_found' as const };
        const check = checkTransition(o.mode, o.status, to);
        if (!check.ok) return { ok: false as const, error: check.error };
        await tx`update public.orders set status = ${to} where id = ${orderId}`;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor)
                 values (${tenantId}, ${orderId}, ${to}, ${actor})`;
        return { ok: true as const, from: o.status, to, tenantId, orderId };
      });
    },

    async findByPosReference(posReference) {
      const [o] = await sql<{ tenant_id: string; id: string }[]>`
        select tenant_id, id from public.orders where pos_reference = ${posReference} limit 1`;
      return o ? { tenantId: o.tenant_id, orderId: o.id } : null;
    },

    async findByPosTicket(tenantId, restaurantId, ticketId) {
      // Casse d'origine, minuscules ou majuscules : l'index (restaurant_id, pos_ticket_id) sert.
      const variants = [...new Set([ticketId, ticketId.toLowerCase(), ticketId.toUpperCase()])];
      const [o] = await sql<
        { id: string; status: OrderStatus; payment_method: 'online' | 'on_site' }[]
      >`
        select id, status, payment_method from public.orders
        where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}
          and pos_ticket_id in ${sql(variants)}
        limit 1`;
      return o ? { orderId: o.id, status: o.status, paymentMethod: o.payment_method } : null;
    },

    async recordPosEvent(tenantId, orderId, status, detail) {
      return sql.begin(async (tx) => {
        await tx`select 1 from public.orders where tenant_id = ${tenantId} and id = ${orderId} for update`;
        const seen = await tx`
          select 1 from public.order_events
          where tenant_id = ${tenantId} and order_id = ${orderId} and status = ${status}
            and actor = ${POS_WEBHOOK_ACTOR}
          limit 1`;
        if (seen.length > 0) return false;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor, detail)
                 values (${tenantId}, ${orderId}, ${status}, ${POS_WEBHOOK_ACTOR},
                         ${tx.json({ ...detail })})`;
        return true;
      });
    },

    async addPushToken(tenantId, orderId, token) {
      await sql`insert into public.order_push_tokens (order_id, tenant_id, expo_push_token)
                values (${orderId}, ${tenantId}, ${token}) on conflict do nothing`;
    },

    async listPushTokens(tenantId, orderId) {
      const rows = await sql<{ expo_push_token: string }[]>`
        select expo_push_token from public.order_push_tokens where tenant_id = ${tenantId} and order_id = ${orderId}`;
      return rows.map((r) => r.expo_push_token);
    },
  };
}
