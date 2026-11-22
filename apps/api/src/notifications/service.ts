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
}

/** Notifie le client d'un changement de statut ; un échec de notification ne bloque jamais la commande. */
export async function notifyStatus(
  deps: NotifyDeps,
  tenantId: string,
  orderId: string,
  status: 'paid' | OperationalStatus,
) {
  try {
    const order = await deps.orders.getOrderDetail(tenantId, orderId);
    if (!order) return;
    const name = await deps.tenantName(tenantId);
    const message = statusNotification(status, order.number, name);
    const tokens = await deps.operations.listPushTokens(tenantId, orderId);
    if (message) await deps.notifier.push(tokens, { ...message, data: { orderId } });
    if (status === 'paid') {
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
