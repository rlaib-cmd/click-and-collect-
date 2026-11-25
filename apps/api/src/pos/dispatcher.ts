import type {
  OperationsStore,
  OrderDetail,
  OrderReader,
  PaymentStore,
  PosTicket,
  PosTicketStore,
  Restaurant,
  RestaurantStore,
} from '@splash360/db';
import type { PaymentGateway } from '../payments/gateway';
import { refundOrder } from '../payments/service';
import { PosRejectedError, type PosGateway } from './gateway';
import { posTiming, type PosTiming } from './handshake';

export interface DispatchDeps {
  readonly operations: OperationsStore;
  readonly orders: OrderReader;
  readonly restaurants: RestaurantStore;
  readonly pos: PosGateway;
  readonly tickets: PosTicketStore;
  /** Remboursement automatique si la caisse ne confirme pas une commande payée. */
  readonly payments: PaymentStore;
  readonly gateway: PaymentGateway | null;
  /** Commande annulée ou remboursée faute de caisse : prévenir le client. */
  readonly onCompensated?: (
    order: { orderId: string; tenantId: string },
    status: 'cancelled' | 'refunded',
  ) => Promise<void>;
  readonly log?: ((message: string, detail?: Record<string, unknown>) => void) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly timing?: Partial<PosTiming> | undefined;
  /** Attente sur place de la réponse de la caisse avant de rendre la main (défaut 8 s). */
  readonly inlineWaitMs?: number | undefined;
  /** Intervalle entre deux interrogations pendant cette attente (défaut 1 s). */
  readonly pollMs?: number | undefined;
}

/** Délais entre deux essais ; au 3e échec, alerte dans le back-office (section 7). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
export const MAX_ATTEMPTS = 3;
/** Nouvelle interrogation d'une caisse qui n'a pas encore répondu (sans compter d'échec). */
export const WAIT_RETRY_MS = 15_000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** La caisse n'a pas répondu à temps, ou a refusé : on compense (annulation ou remboursement). */
class PosGaveUpError extends Error {}

/**
 * Fait avancer en caisse les commandes payées (ou confirmées sur place) : dépôt si besoin,
 * attente de « ready », envoi du paiement, attente de « confirmed » (ADR 0018).
 * Sûr avec plusieurs instances : chaque envoi est réservé (SKIP LOCKED) avant d'être traité.
 */
export async function processDispatches(
  deps: DispatchDeps,
  batch = 20,
): Promise<{ sent: number; failed: number; waiting: number }> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.operations.claimDueDispatches(batch);
  let sent = 0;
  let failed = 0;
  let waiting = 0;
  for (const d of due) {
    try {
      const order = await deps.orders.getOrderDetail(d.tenantId, d.orderId);
      const restaurant = order
        ? await deps.restaurants.findById(d.tenantId, order.restaurantId)
        : null;
      if (!order || !restaurant)
        throw new PosRejectedError('Commande ou restaurant introuvable', false);
      const outcome = await advance(deps, order, restaurant);
      if (outcome === 'confirmed') {
        sent += 1;
      } else {
        waiting += 1;
        await deps.tickets.deferDispatch(d.orderId, new Date(now().getTime() + WAIT_RETRY_MS));
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PosGaveUpError) {
        await deps.operations.markDispatchFailed(d.orderId, message, null);
        await compensate(deps, d.tenantId, d.orderId, message);
        continue;
      }
      const retryable = !(error instanceof PosRejectedError) || error.retryable;
      const delay = RETRY_DELAYS_MS[d.attempts - 1];
      const retryAt =
        retryable && d.attempts < MAX_ATTEMPTS && delay !== undefined
          ? new Date(now().getTime() + delay)
          : null;
      await deps.operations.markDispatchFailed(d.orderId, message, retryAt);
      deps.log?.(
        retryAt
          ? 'Envoi à la caisse en échec, nouvel essai prévu'
          : 'Envoi à la caisse abandonné : alerte back-office',
        { orderId: d.orderId, attempts: d.attempts, error: message },
      );
    }
  }
  return { sent, failed, waiting };
}

/** Avance d'autant d'étapes que possible ; « waiting » si la caisse n'a pas encore répondu. */
async function advance(
  deps: DispatchDeps,
  order: OrderDetail,
  restaurant: Restaurant,
): Promise<'confirmed' | 'waiting'> {
  const now = deps.now ?? (() => new Date());
  const timing = posTiming(deps);
  const { tenantId, id: orderId } = order;
  // Commande annulée ou remboursée : elle ne doit jamais partir (ou repartir) en caisse (audit M5).
  if (order.status === 'cancelled' || order.status === 'refunded')
    throw new PosRejectedError('Commande annulée ou remboursée : pas d’envoi en caisse', false);
  let ticket: PosTicket | null = await deps.tickets.getTicket(tenantId, orderId);

  // Sur place (ou commande antérieure au lot 14) : la commande n'a pas encore de ticket.
  if (!ticket) {
    const { ticketId } = await deps.pos.openTicket(order, restaurant);
    await deps.tickets.openTicket(tenantId, orderId, ticketId, now());
    ticket = await deps.tickets.getTicket(tenantId, orderId);
    if (!ticket) throw new PosRejectedError('Ticket de caisse non enregistré', true);
  }
  if (ticket.phase === 'failed') throw new PosGaveUpError(ticket.error ?? 'Refusée par la caisse');

  if (ticket.phase === 'waiting') {
    const state = await waitFor(deps, order, restaurant, ticket, 'ready');
    if (state === 'failed') throw await giveUp(deps, order, 'Refusée par la caisse');
    if (state === 'pending') {
      if (now().getTime() - ticket.openedAt.getTime() > timing.readyTimeoutMs)
        throw await giveUp(deps, order, 'La caisse n’a pas accepté la commande à temps');
      return 'waiting';
    }
    await deps.tickets.setPhase(tenantId, orderId, 'ready', now());
    ticket = { ...ticket, phase: 'ready' };
  }

  if (ticket.phase === 'ready') {
    if (order.paymentMethod === 'on_site') {
      await deps.pos.submitPayment(
        { ticketId: ticket.ticketId, restaurant },
        { method: 'on_site' },
      );
    } else {
      const payable = await deps.payments.getOrder(tenantId, orderId);
      if (!payable?.paymentIntentId) throw new PosRejectedError('Paiement introuvable', false);
      await deps.pos.submitPayment(
        { ticketId: ticket.ticketId, restaurant },
        {
          method: 'card',
          amountCents: order.totals.totalCents,
          reference: payable.paymentIntentId,
        },
      );
    }
    const sentAt = now();
    await deps.tickets.setPhase(tenantId, orderId, 'payment_sent', sentAt);
    ticket = { ...ticket, phase: 'payment_sent', paymentSentAt: sentAt };
  }

  if (ticket.phase === 'payment_sent') {
    const state = await waitFor(deps, order, restaurant, ticket, 'confirmed');
    if (state === 'failed') throw await giveUp(deps, order, 'Paiement refusé par la caisse');
    if (state !== 'confirmed') {
      const sentAt = ticket.paymentSentAt ?? ticket.openedAt;
      if (now().getTime() - sentAt.getTime() > timing.confirmTimeoutMs)
        throw await giveUp(deps, order, 'La caisse n’a pas confirmé la commande à temps');
      return 'waiting';
    }
    await deps.tickets.setPhase(tenantId, orderId, 'confirmed', now());
  }

  await deps.operations.markDispatched(orderId, ticket.ticketId);
  return 'confirmed';
}

/** Interroge la caisse jusqu'à l'état voulu, au plus `inlineWaitMs`. */
async function waitFor(
  deps: DispatchDeps,
  order: OrderDetail,
  restaurant: Restaurant,
  ticket: PosTicket,
  target: 'ready' | 'confirmed',
): Promise<'pending' | 'ready' | 'confirmed' | 'failed'> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? realSleep;
  const pollMs = deps.pollMs ?? 1000;
  const deadline = now().getTime() + (deps.inlineWaitMs ?? 8000);
  for (;;) {
    const status = await deps.pos.ticketStatus({
      ticketId: ticket.ticketId,
      restaurant,
      openedAt: ticket.openedAt,
      paymentSentAt: ticket.paymentSentAt,
    });
    await deps.tickets.recordCheck(order.tenantId, order.id, now(), status.raw);
    if (status.state === 'failed') return 'failed';
    if (status.state === 'confirmed') return 'confirmed';
    if (status.state === 'ready' && target === 'ready') return 'ready';
    if (now().getTime() + pollMs > deadline) return 'pending';
    await sleep(pollMs);
  }
}

async function giveUp(deps: DispatchDeps, order: OrderDetail, reason: string) {
  await deps.tickets.setPhase(
    order.tenantId,
    order.id,
    'failed',
    (deps.now ?? (() => new Date()))(),
    {
      error: reason,
    },
  );
  return new PosGaveUpError(reason);
}

/** Sur place : commande annulée. Payée en ligne : remboursement intégral automatique. */
async function compensate(deps: DispatchDeps, tenantId: string, orderId: string, reason: string) {
  const order = await deps.orders.getOrderDetail(tenantId, orderId);
  if (!order) return;
  try {
    if (order.paymentMethod === 'on_site') {
      if (await deps.tickets.cancelForPos(tenantId, orderId, reason)) {
        await deps.onCompensated?.({ orderId, tenantId }, 'cancelled');
      }
    } else {
      const remaining = order.totals.totalCents - order.refundedCents;
      if (remaining <= 0) return;
      const refund = await refundOrder(
        { payments: deps.payments, gateway: deps.gateway },
        { tenantId, orderId, amountCents: remaining, actor: 'pos', requestId: 'pos-failed' },
      );
      if (refund.ok) await deps.onCompensated?.({ orderId, tenantId }, 'refunded');
      else
        deps.log?.('Remboursement automatique impossible : à faire au back-office', {
          orderId,
          error: refund.error,
        });
    }
  } catch (error) {
    deps.log?.('Compensation après refus de la caisse en échec', {
      orderId,
      error: String(error),
    });
  }
  deps.log?.('Caisse : commande abandonnée, client compensé', { orderId, reason });
}
