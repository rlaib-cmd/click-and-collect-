import type { Sql } from './client';

/**
 * Poignée de main avec la caisse Splash360 (ADR 0018), suivie sur la commande :
 * waiting (ticket déposé) → ready (la caisse peut l'accepter : paiement possible)
 * → payment_sent (paiement notifié) → confirmed (intégrée en caisse) ; failed à tout moment.
 */
export type PosPhase = 'waiting' | 'ready' | 'payment_sent' | 'confirmed' | 'failed';

export interface PosTicket {
  readonly ticketId: string;
  readonly phase: PosPhase;
  readonly openedAt: Date;
  readonly readyAt: Date | null;
  readonly paymentSentAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly checkedAt: Date | null;
  readonly lastStatus: string | null;
  readonly error: string | null;
}

export interface PosTicketStore {
  getTicket(tenantId: string, orderId: string): Promise<PosTicket | null>;
  /** Enregistre le ticket déposé (phase waiting) ; faux si la commande en a déjà un. */
  openTicket(tenantId: string, orderId: string, ticketId: string, at: Date): Promise<boolean>;
  /** Change de phase et date l'étape atteinte. */
  setPhase(
    tenantId: string,
    orderId: string,
    phase: PosPhase,
    at: Date,
    detail?: { readonly lastStatus?: string | null; readonly error?: string | null },
  ): Promise<void>;
  /** Trace la dernière interrogation de la caisse (limite le rythme des appels). */
  recordCheck(
    tenantId: string,
    orderId: string,
    at: Date,
    lastStatus: string | null,
  ): Promise<void>;
  /**
   * Annule une commande que la caisse n'a pas acceptée, tant qu'elle n'est pas payée
   * (ou confirmée « à payer sur place ») ; faux si elle a déjà avancé.
   */
  cancelForPos(tenantId: string, orderId: string, reason: string): Promise<boolean>;
  /** Remet un envoi en file sans le compter comme un échec (attente de la caisse). */
  deferDispatch(orderId: string, retryAt: Date): Promise<void>;
}

interface Row {
  pos_ticket_id: string;
  pos_phase: PosPhase;
  pos_opened_at: Date;
  pos_ready_at: Date | null;
  pos_payment_sent_at: Date | null;
  pos_confirmed_at: Date | null;
  pos_checked_at: Date | null;
  pos_last_status: string | null;
  pos_error: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresPosTicketStore(sql: Sql): PosTicketStore {
  return {
    async getTicket(tenantId, orderId) {
      if (!UUID.test(orderId)) return null;
      const [r] = await sql<Row[]>`
        select pos_ticket_id, pos_phase, pos_opened_at, pos_ready_at, pos_payment_sent_at,
               pos_confirmed_at, pos_checked_at, pos_last_status, pos_error
        from public.orders
        where tenant_id = ${tenantId} and id = ${orderId} and pos_ticket_id is not null`;
      if (!r) return null;
      return {
        ticketId: r.pos_ticket_id,
        phase: r.pos_phase,
        openedAt: r.pos_opened_at,
        readyAt: r.pos_ready_at,
        paymentSentAt: r.pos_payment_sent_at,
        confirmedAt: r.pos_confirmed_at,
        checkedAt: r.pos_checked_at,
        lastStatus: r.pos_last_status,
        error: r.pos_error,
      };
    },

    async openTicket(tenantId, orderId, ticketId, at) {
      const rows = await sql`
        update public.orders
        set pos_ticket_id = ${ticketId}, pos_phase = 'waiting', pos_opened_at = ${at}, pos_error = null
        where tenant_id = ${tenantId} and id = ${orderId} and pos_ticket_id is null
        returning id`;
      return rows.length > 0;
    },

    async setPhase(tenantId, orderId, phase, at, detail = {}) {
      await sql`
        update public.orders set
          pos_phase = ${phase},
          pos_ready_at = case when ${phase} = 'ready' then ${at}::timestamptz else pos_ready_at end,
          pos_payment_sent_at = case when ${phase} = 'payment_sent' then ${at}::timestamptz else pos_payment_sent_at end,
          pos_confirmed_at = case when ${phase} = 'confirmed' then ${at}::timestamptz else pos_confirmed_at end,
          pos_checked_at = ${at},
          pos_last_status = coalesce(${detail.lastStatus ?? null}, pos_last_status),
          pos_error = ${detail.error ?? null}
        where tenant_id = ${tenantId} and id = ${orderId} and pos_ticket_id is not null`;
    },

    async recordCheck(tenantId, orderId, at, lastStatus) {
      await sql`
        update public.orders
        set pos_checked_at = ${at}, pos_last_status = coalesce(${lastStatus}, pos_last_status)
        where tenant_id = ${tenantId} and id = ${orderId}`;
    },

    async cancelForPos(tenantId, orderId, reason) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          update public.orders set status = 'cancelled'
          where tenant_id = ${tenantId} and id = ${orderId}
            and status in ('pending_payment', 'payment_failed', 'confirmed')
          returning id`;
        if (rows.length === 0) return false;
        await tx`insert into public.order_events (tenant_id, order_id, status, actor, detail)
                 values (${tenantId}, ${orderId}, 'cancelled', 'pos', ${tx.json({ reason })})`;
        return true;
      });
    },

    async deferDispatch(orderId, retryAt) {
      await sql`
        update public.pos_dispatches
        set status = 'pending', next_attempt_at = ${retryAt}, attempts = greatest(attempts - 1, 0)
        where order_id = ${orderId}`;
    },
  };
}
