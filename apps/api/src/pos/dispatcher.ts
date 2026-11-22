import type { OperationsStore, OrderReader, RestaurantStore } from '@splash360/db';
import { PosRejectedError, type PosGateway } from './gateway';

export interface DispatchDeps {
  readonly operations: OperationsStore;
  readonly orders: OrderReader;
  readonly restaurants: RestaurantStore;
  readonly pos: PosGateway;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
  readonly now?: () => Date;
}

/** Délais entre deux essais ; au 3e échec, alerte dans le back-office (section 7). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
export const MAX_ATTEMPTS = 3;

/**
 * Envoie à la caisse les commandes payées en attente. Sûr avec plusieurs instances :
 * chaque envoi est réservé (SKIP LOCKED) avant d'être traité.
 */
export async function processDispatches(
  deps: DispatchDeps,
  batch = 20,
): Promise<{ sent: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.operations.claimDueDispatches(batch);
  let sent = 0;
  let failed = 0;
  for (const d of due) {
    try {
      const order = await deps.orders.getOrderDetail(d.tenantId, d.orderId);
      const restaurant = order
        ? await deps.restaurants.findById(d.tenantId, order.restaurantId)
        : null;
      if (!order || !restaurant)
        throw new PosRejectedError('Commande ou restaurant introuvable', false);
      const { reference } = await deps.pos.submitOrder(order, restaurant);
      await deps.operations.markDispatched(d.orderId, reference);
      sent += 1;
    } catch (error) {
      failed += 1;
      const retryable = !(error instanceof PosRejectedError) || error.retryable;
      const delay = RETRY_DELAYS_MS[d.attempts - 1];
      const retryAt =
        retryable && d.attempts < MAX_ATTEMPTS && delay !== undefined
          ? new Date(now().getTime() + delay)
          : null;
      const message = error instanceof Error ? error.message : String(error);
      await deps.operations.markDispatchFailed(d.orderId, message, retryAt);
      deps.log?.(
        retryAt
          ? 'Envoi à la caisse en échec, nouvel essai prévu'
          : 'Envoi à la caisse abandonné : alerte back-office',
        {
          orderId: d.orderId,
          attempts: d.attempts,
          error: message,
        },
      );
    }
  }
  return { sent, failed };
}
