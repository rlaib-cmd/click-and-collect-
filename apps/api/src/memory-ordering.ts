import type { SlotLoad } from '@splash360/core';
import {
  SLOT_HOLDING_STATUSES,
  type CreateOrderResult,
  type NewOrder,
  type OrderingConfig,
  type OrderingStore,
} from '@splash360/db';

interface StoredOrder extends NewOrder {
  readonly id: string;
  readonly number: number;
  status: string;
  readonly createdAt: string;
}

/** Implémentation en mémoire de `OrderingStore`, pour les tests (mêmes règles que Postgres). */
export function createMemoryOrderingStore(configs: Record<string, OrderingConfig>) {
  const orders: StoredOrder[] = [];
  let counter = 1000;

  const load = (restaurantId: string, from: Date, to: Date): SlotLoad => {
    const out: Record<string, number> = {};
    for (const o of orders) {
      if (o.restaurantId !== restaurantId || !o.requestedSlot) continue;
      if (!(SLOT_HOLDING_STATUSES as readonly string[]).includes(o.status)) continue;
      const t = new Date(o.requestedSlot).getTime();
      if (t >= from.getTime() && t <= to.getTime())
        out[o.requestedSlot] = (out[o.requestedSlot] ?? 0) + 1;
    }
    return out;
  };

  const store: OrderingStore & { orders: StoredOrder[] } = {
    orders,
    getConfig: (_tenantId, restaurantId) => Promise.resolve(configs[restaurantId] ?? null),
    slotLoad: (restaurantId, from, to) => Promise.resolve(load(restaurantId, from, to)),
    createOrder(o): Promise<CreateOrderResult> {
      const existing = orders.find(
        (x) => x.tenantId === o.tenantId && x.idempotencyKey === o.idempotencyKey,
      );
      const summary = (x: StoredOrder) => ({
        id: x.id,
        number: x.number,
        status: x.status,
        totalCents: x.totals.totalCents,
        createdAt: x.createdAt,
      });
      if (existing) return Promise.resolve({ ok: true, replayed: true, order: summary(existing) });
      if (o.requestedSlot && o.maxOrdersPerSlot !== null) {
        const at = new Date(o.requestedSlot);
        if ((load(o.restaurantId, at, at)[o.requestedSlot] ?? 0) >= o.maxOrdersPerSlot) {
          return Promise.resolve({ ok: false, error: 'slot_full' });
        }
      }
      counter += 1;
      const stored: StoredOrder = {
        ...o,
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        number: counter,
        status: 'pending_payment',
        createdAt: new Date().toISOString(),
      };
      orders.push(stored);
      return Promise.resolve({ ok: true, replayed: false, order: summary(stored) });
    },
  };
  return store;
}
