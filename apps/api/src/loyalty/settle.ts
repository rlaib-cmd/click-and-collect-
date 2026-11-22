import type { LoyaltyProvider } from '@splash360/api-loyalty';
import { cents, pointsForAmount } from '@splash360/core';
import type { OrderReader, PaymentStore, TenantStore } from '@splash360/db';

/**
 * Commande payée : points crédités et récompense consommée chez Splash360, une seule fois
 * (le fournisseur est idempotent par commande ; la commande est marquée une fois réglée).
 */
export async function settleLoyalty(
  deps: {
    readonly loyalty?: LoyaltyProvider | undefined;
    readonly tenants: TenantStore;
    readonly orders: OrderReader;
    readonly payments: PaymentStore;
    readonly log: (message: string, data?: Record<string, unknown>) => void;
  },
  tenantId: string,
  orderId: string,
  /** Statut qui déclenche le règlement : « paid » en ligne, « completed » sur place. */
  trigger: string,
): Promise<void> {
  if (!deps.loyalty) return;
  const order = await deps.orders.getOrderDetail(tenantId, orderId);
  if (!order?.loyalty || order.loyalty.settled) return;
  // Sur place : les points ne sont acquis qu'une fois la commande remise (donc encaissée) — ADR 0010.
  if (order.paymentMethod === 'on_site' ? trigger !== 'completed' : trigger !== 'paid') return;
  const tenantRow = await deps.tenants.findById(tenantId);
  if (!tenantRow) return;
  const tenant = { id: tenantRow.id, splash360Id: tenantRow.splash360Id };
  const program = await deps.loyalty.getProgram(tenant);
  if (!program) return;
  const reward = order.loyalty.rewardId
    ? (program.rewards.find((r) => r.id === order.loyalty?.rewardId) ?? null)
    : null;
  const result = await deps.loyalty.settleOrder(tenant, {
    memberId: order.loyalty.memberId,
    orderId: order.id,
    orderNumber: order.number,
    earnPoints: pointsForAmount(cents(order.totals.totalCents), program),
    reward: reward
      ? {
          id: reward.id,
          name: reward.name,
          costPoints: order.loyalty.rewardPoints ?? reward.costPoints,
        }
      : null,
  });
  if (!result.ok) {
    // Commande déjà payée : on la sert, l'écart de points est signalé pour traitement manuel.
    deps.log('Fidélité non réglée', { orderId, error: result.error });
    return;
  }
  await deps.payments.markLoyaltySettled(tenantId, orderId);
}
