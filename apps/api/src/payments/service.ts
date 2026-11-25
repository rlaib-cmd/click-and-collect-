import type { PaymentStore } from '@splash360/db';
import type { PaymentEvent, PaymentGateway } from './gateway';

export interface PaymentDeps {
  readonly payments: PaymentStore;
  readonly gateway: PaymentGateway | null;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
  /** Appelé quand une commande vient d'être payée (envoi à la caisse, lot 5). */
  readonly onPaid?: (order: { orderId: string; tenantId: string }) => Promise<void>;
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'rejected';

/**
 * Traite un événement Stripe déjà vérifié. Idempotent : un webhook reçu deux fois
 * ne change l'état qu'une fois (Stripe peut renvoyer le même événement).
 */
export async function handlePaymentEvent(
  deps: PaymentDeps,
  event: PaymentEvent,
): Promise<WebhookOutcome> {
  switch (event.type) {
    case 'payment_succeeded': {
      const result = await deps.payments.markPaid(
        event.paymentIntentId,
        event.amountCents,
        event.currency,
      );
      if (!result.ok) {
        deps.log?.('Paiement Stripe non rapproché', {
          paymentIntentId: event.paymentIntentId,
          error: result.error,
        });
        return 'rejected';
      }
      if (!result.changed) return 'duplicate';
      await deps.onPaid?.({ orderId: result.orderId, tenantId: result.tenantId });
      return 'processed';
    }
    case 'payment_failed': {
      const result = await deps.payments.markPaymentFailed(event.paymentIntentId);
      if (!result.ok) return 'rejected';
      return result.changed ? 'processed' : 'duplicate';
    }
    case 'account_updated':
      await deps.payments.setChargesEnabled(event.accountId, event.chargesEnabled);
      return 'processed';
    case 'ignored':
      return 'ignored';
  }
}

/** Délai au-delà duquel une commande non payée est annulée et son créneau libéré (section 5). */
export const PAYMENT_TIMEOUT_MS = 15 * 60_000;

export async function expireUnpaidOrders(deps: PaymentDeps, now: Date): Promise<number> {
  const expired = await deps.payments.expirePending(new Date(now.getTime() - PAYMENT_TIMEOUT_MS));
  for (const o of expired) {
    if (deps.gateway && o.paymentIntentId && o.stripeAccountId) {
      // Au mieux : si l'annulation échoue, un paiement tardif sera quand même rattrapé par le webhook.
      await deps.gateway
        .cancelPaymentIntent(o.paymentIntentId, o.stripeAccountId)
        .catch((error: unknown) => {
          deps.log?.('Annulation du PaymentIntent impossible', {
            orderId: o.orderId,
            error: String(error),
          });
        });
    }
  }
  return expired.length;
}

export type RefundOutcome =
  | { readonly ok: true; readonly refundedCents: number; readonly fullyRefunded: boolean }
  | {
      readonly ok: false;
      readonly error: 'not_found' | 'not_refundable' | 'amount_too_high' | 'payments_unavailable';
    };

/**
 * Remboursement total ou partiel (back-office). Contrôle d'abord en base, puis Stripe,
 * avec une clé d'idempotence par remboursement ; l'historique de la commande garde l'auteur.
 */
export async function refundOrder(
  deps: PaymentDeps,
  input: {
    tenantId: string;
    orderId: string;
    amountCents: number;
    actor: string;
    requestId: string;
  },
): Promise<RefundOutcome> {
  if (!deps.gateway) return { ok: false, error: 'payments_unavailable' };
  const order = await deps.payments.getOrder(input.tenantId, input.orderId);
  if (!order) return { ok: false, error: 'not_found' };
  if (!order.paymentIntentId || !order.stripeAccountId)
    return { ok: false, error: 'not_refundable' };
  if (order.refundedCents + input.amountCents > order.totalCents || input.amountCents <= 0) {
    return { ok: false, error: 'amount_too_high' };
  }
  await deps.gateway.refund({
    paymentIntentId: order.paymentIntentId,
    connectedAccountId: order.stripeAccountId,
    amountCents: input.amountCents,
    idempotencyKey: `refund-${input.orderId}-${input.requestId}`,
    refundApplicationFee: order.applicationFeeCents > 0,
  });
  const recorded = await deps.payments.recordRefund(
    input.tenantId,
    input.orderId,
    input.amountCents,
    input.actor,
  );
  return recorded.ok ? recorded : { ok: false, error: recorded.error };
}
