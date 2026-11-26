import type { MenuCache, Splash360WebhookPayload } from '@splash360/api-menu';
import {
  POS_WEBHOOK_ACTOR,
  type OperationsStore,
  type PaymentStore,
  type PosTicketStore,
  type Restaurant,
  type Splash360WebhookStore,
  type WebhookReceiptOutcome,
  type WebhookSummary,
} from '@splash360/db';
import { notifyStatus, type NotifyDeps } from '../notifications/service';
import type { PaymentGateway } from '../payments/gateway';
import { refundOrder } from '../payments/service';

/**
 * Traitement des webhooks Splash360 (lot 23, ADR 0029), après la réponse 2xx :
 * - disponibilité et prix de livraison : états enregistrés, appliqués à la carte servie et au
 *   calcul du prix (`createStockMenuCache`) ;
 * - mise à jour du catalogue : carte rechargée, prix de livraison propres plus anciens effacés ;
 * - encaissement / annulation : mêmes chemins que l'équipe et la caisse aujourd'hui.
 */
export interface Splash360ProcessDeps {
  readonly store: Splash360WebhookStore;
  /** Cache de carte : rechargé à la mise à jour du catalogue. */
  readonly menus: MenuCache;
  /** États de la caisse gardés en mémoire (`createStockMenuCache`) : relus après un changement. */
  readonly stock: { refreshStock(restaurantId: string): void };
  readonly operations: OperationsStore;
  readonly tickets: PosTicketStore;
  readonly payments: PaymentStore;
  readonly gateway: PaymentGateway | null;
  readonly notify: NotifyDeps;
  readonly log: (message: string, detail?: Record<string, unknown>) => void;
}

export interface WebhookJob {
  readonly webhookId: string;
  readonly restaurant: Restaurant;
  readonly payload: Splash360WebhookPayload;
  readonly receivedAt: Date;
}

export interface WebhookResult {
  readonly outcome: WebhookReceiptOutcome;
  readonly summary: WebhookSummary;
}

/** Statuts après paiement en ligne : un remboursement y est possible. */
const PAID_ONLINE = ['paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];
/** Commande à payer sur place, pas encore remise : la caisse peut l'encaisser. */
const ON_SITE_OPEN = ['confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

export async function processSplash360Webhook(
  deps: Splash360ProcessDeps,
  job: WebhookJob,
): Promise<WebhookResult> {
  const { restaurant, payload, webhookId, receivedAt } = job;
  switch (payload.event) {
    case 'stock': {
      // Tableau vide : appel de test (§8.5).
      if (payload.items.length === 0)
        return { outcome: 'test', summary: { items: 0, skipped: payload.skipped } };
      await deps.store.setAvailability(
        restaurant.tenantId,
        restaurant.id,
        payload.items,
        webhookId,
        receivedAt,
      );
      deps.stock.refreshStock(restaurant.id);
      return {
        outcome: 'applied',
        summary: {
          items: payload.items.length,
          unavailable: payload.items.filter((i) => !i.available).length,
          skipped: payload.skipped,
        },
      };
    }
    case 'prices': {
      if (payload.items.length === 0)
        return { outcome: 'test', summary: { items: 0, skipped: payload.skipped } };
      await deps.store.setDeliveryPrices(
        restaurant.tenantId,
        restaurant.id,
        payload.items,
        webhookId,
        receivedAt,
      );
      deps.stock.refreshStock(restaurant.id);
      return {
        outcome: 'applied',
        summary: { items: payload.items.length, skipped: payload.skipped },
      };
    }
    case 'catalog': {
      if (payload.test) return { outcome: 'test', summary: { catalogId: payload.catalogId } };
      // Prix de livraison propres posés avant l'installation : le catalogue installé fait foi
      // (le retour au prix du catalogue ne donne lieu à aucun appel, §8.2). Disponibilités gardées.
      const clearedPrices = await deps.store.clearDeliveryPrices(
        restaurant.tenantId,
        restaurant.id,
        payload.installedAt && payload.installedAt < receivedAt ? payload.installedAt : receivedAt,
      );
      deps.menus.invalidate(restaurant.id);
      deps.stock.refreshStock(restaurant.id);
      return {
        outcome: 'applied',
        summary: { catalogId: payload.catalogId, revision: payload.revision, clearedPrices },
      };
    }
    case 'orders':
      return processOrder(deps, restaurant, payload);
  }
}

type OrderPayload = Extract<Splash360WebhookPayload, { event: 'orders' }>;

/**
 * Encaissement / annulation en caisse (§8.4), idempotent sur commande + statut :
 * - annulée : sur place → annulée (comme l'annulation par l'équipe) ; payée en ligne → reste
 *   remboursé (comme un refus de la caisse) ; client prévenu dans les deux cas ;
 * - encaissée : sur place → remise (points du club acquis comme aujourd'hui) ; en ligne → simple
 *   trace : seul le webhook Stripe vérifié fait passer une commande à « payée ».
 */
async function processOrder(
  deps: Splash360ProcessDeps,
  restaurant: Restaurant,
  payload: OrderPayload,
): Promise<WebhookResult> {
  const summary = { status: payload.status };
  // Appel de test : cette commande n'existe pas (§8.5).
  if (payload.test) return { outcome: 'test', summary };
  const { tenantId } = restaurant;
  const order = await deps.operations.findByPosTicket(tenantId, restaurant.id, payload.ticketId);
  if (!order) return { outcome: 'unknown_order', summary };
  const { orderId } = order;
  const recorded = await deps.operations.recordPosEvent(
    tenantId,
    orderId,
    payload.status === 'paid' ? 'pos_paid' : 'pos_cancelled',
    {
      reason: payload.reason,
      occurredAt: payload.occurredAt?.toISOString() ?? null,
      amountCents: payload.amountCents,
    },
  );
  const result = (effect: string, outcome: WebhookReceiptOutcome = 'applied'): WebhookResult => ({
    outcome,
    summary: { ...summary, effect, firstTime: recorded },
  });

  if (payload.status === 'paid') {
    if (order.paymentMethod !== 'on_site') return result('recorded');
    if (!ON_SITE_OPEN.includes(order.status)) return result('already', 'ignored');
    const change = await deps.operations.changeStatus(
      tenantId,
      orderId,
      'completed',
      POS_WEBHOOK_ACTOR,
    );
    if (!change.ok) return result(change.error, 'ignored');
    await notifyStatus(deps.notify, tenantId, orderId, 'completed');
    return result('completed');
  }

  // Annulée en caisse.
  if (['pending_payment', 'payment_failed', 'confirmed'].includes(order.status)) {
    // Pas encore payée (ou à payer sur place) : même chemin qu'un refus de la caisse.
    const cancelled = await deps.tickets.cancelForPos(
      tenantId,
      orderId,
      payload.reason ?? 'Annulée en caisse',
    );
    if (!cancelled) return result('already', 'ignored');
    if (order.paymentMethod === 'online') await cancelPaymentIntent(deps, tenantId, orderId);
    await notifyStatus(deps.notify, tenantId, orderId, 'cancelled');
    return result('cancelled');
  }
  if (order.paymentMethod === 'on_site') {
    const change = await deps.operations.changeStatus(
      tenantId,
      orderId,
      'cancelled',
      POS_WEBHOOK_ACTOR,
    );
    if (!change.ok) return result(change.error, 'ignored');
    await notifyStatus(deps.notify, tenantId, orderId, 'cancelled');
    return result('cancelled');
  }
  if (!PAID_ONLINE.includes(order.status)) return result('already', 'ignored');
  const payable = await deps.payments.getOrder(tenantId, orderId);
  const remaining = payable ? payable.totalCents - payable.refundedCents : 0;
  if (remaining <= 0) return result('already', 'ignored');
  const refund = await refundOrder(
    { payments: deps.payments, gateway: deps.gateway },
    {
      tenantId,
      orderId,
      amountCents: remaining,
      actor: POS_WEBHOOK_ACTOR,
      // Une seule demande de remboursement par annulation en caisse (rejeu sans effet).
      requestId: 'splash360-cancelled',
    },
  );
  if (!refund.ok) {
    deps.log(
      'Annulation en caisse : remboursement automatique impossible, à faire au back-office',
      {
        orderId,
        error: refund.error,
      },
    );
    return result(`refund_${refund.error}`, 'failed');
  }
  await notifyStatus(deps.notify, tenantId, orderId, 'cancelled');
  return result('refunded');
}

/** Paiement en ligne pas encore terminé : le PaymentIntent est annulé (au mieux). */
async function cancelPaymentIntent(deps: Splash360ProcessDeps, tenantId: string, orderId: string) {
  const payable = await deps.payments.getOrder(tenantId, orderId);
  if (!deps.gateway || !payable?.paymentIntentId || !payable.stripeAccountId) return;
  await deps.gateway
    .cancelPaymentIntent(payable.paymentIntentId, payable.stripeAccountId)
    .catch((error: unknown) =>
      deps.log('Annulation du PaymentIntent impossible', { orderId, error: String(error) }),
    );
}
