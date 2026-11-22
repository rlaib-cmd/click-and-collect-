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

/** Opérations après paiement : envoi à la caisse, statuts, jetons de notification. */
export interface OperationsStore {
  /** Réserve les envois dus (bail de 2 min pour qu'une autre instance ne les prenne pas en même temps). */
  claimDueDispatches(limit: number): Promise<DueDispatch[]>;
  markDispatched(orderId: string, externalReference: string): Promise<void>;
  /** `retryAt` null : abandon définitif, l'alerte apparaît au back-office. */
  markDispatchFailed(orderId: string, error: string, retryAt: Date | null): Promise<void>;
  listFailedDispatches(tenantId: string): Promise<FailedDispatch[]>;
  /** Relance manuelle depuis le back-office. */
  retryDispatch(tenantId: string, orderId: string): Promise<boolean>;
  /** Changement de statut contrôlé par la machine à états de `core`, tracé avec son auteur. */
  changeStatus(
    tenantId: string,
    orderId: string,
    to: OperationalStatus,
    actor: string,
  ): Promise<StatusChange>;
  findByPosReference(posReference: string): Promise<{ tenantId: string; orderId: string } | null>;
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

    async listFailedDispatches(tenantId) {
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
        order by d.updated_at desc`;
      return rows.map((r) => ({
        orderId: r.order_id,
        number: r.number,
        attempts: r.attempts,
        lastError: r.last_error,
        updatedAt: r.updated_at.toISOString(),
      }));
    },

    async retryDispatch(tenantId, orderId) {
      const rows = await sql`
        update public.pos_dispatches set status = 'pending', next_attempt_at = now(), attempts = 0
        where tenant_id = ${tenantId} and order_id = ${orderId} and status = 'failed'`;
      return rows.count === 1;
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
