import type { OperationalStatus } from '@splash360/core';
import type { OperationsStore, OrderReader, TenantStore } from '@splash360/db';
import { receiptEmail, statusNotification } from './messages';
import type { NotificationSender } from './sender';

export interface NotifyDeps {
  readonly operations: OperationsStore;
  readonly orders: OrderReader;
  readonly tenantName: (tenantId: string) => Promise<string>;
  readonly notifier: NotificationSender;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
  /** Appelé à chaque changement de statut (fidélité des commandes payées sur place). */
  readonly afterStatus?: (tenantId: string, orderId: string, status: string) => Promise<void>;
}

/** Notifie le client d'un changement de statut ; un échec de notification ne bloque jamais la commande. */
export async function notifyStatus(
  deps: NotifyDeps,
  tenantId: string,
  orderId: string,
  status: 'paid' | 'confirmed' | OperationalStatus,
) {
  await deps
    .afterStatus?.(tenantId, orderId, status)
    .catch((error: unknown) =>
      deps.log?.('Suite du changement de statut en échec', { orderId, error: String(error) }),
    );
  try {
    const order = await deps.orders.getOrderDetail(tenantId, orderId);
    if (!order) return;
    const name = await deps.tenantName(tenantId);
    const message = statusNotification(status, order.number, name);
    const tokens = await deps.operations.listPushTokens(tenantId, orderId);
    if (message) await deps.notifier.push(tokens, { ...message, data: { orderId } });
    // Reçu par e-mail seulement si le client en a donné un (facultatif, ADR 0013).
    if ((status === 'paid' || status === 'confirmed') && order.customer.email) {
      await deps.notifier.email(
        order.customer.email,
        receiptEmail({
          tenantName: name,
          number: order.number,
          lines: order.lines,
          totals: order.totals,
        }),
      );
    }
  } catch (error) {
    deps.log?.('Notification non envoyée', { orderId, status, error: String(error) });
  }
}

export function tenantNameResolver(tenants: TenantStore) {
  return async (tenantId: string) => (await tenants.findById(tenantId))?.name ?? '';
}
