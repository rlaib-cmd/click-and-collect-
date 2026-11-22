import type { SlotLoad } from '@splash360/core';
import {
  SLOT_HOLDING_STATUSES,
  type CreateOrderResult,
  type NewOrder,
  type OrderDetail,
  type OrderingConfig,
  type OrderingStore,
  type OrderReader,
  type PaymentStore,
  type Restaurant,
} from '@splash360/db';

export interface StoredOrder extends NewOrder {
  readonly id: string;
  readonly number: number;
  status: string;
  paymentIntentId: string | null;
  refundedCents: number;
  createdAt: string;
  events: { status: string; actor: string; at: string }[];
}

const PAID = ['paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];

/**
 * Implémentation en mémoire des dépôts de commande et de paiement, pour les tests.
 * Mêmes règles que Postgres (capacité, idempotence, montants, transitions).
 */
export function createMemoryOrderBackend(
  configs: Record<string, OrderingConfig>,
  restaurants: () => readonly Restaurant[],
) {
  const orders: StoredOrder[] = [];
  let counter = 1000;
  const accounts = new Map<string, boolean>();

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
  const event = (o: StoredOrder, status: string, actor: string) =>
    o.events.push({ status, actor, at: new Date().toISOString() });
  const byPi = (pi: string) => orders.find((o) => o.paymentIntentId === pi);
  const restaurant = (o: StoredOrder) => restaurants().find((r) => r.id === o.restaurantId);

  const ordering: OrderingStore = {
    getConfig: (_tenantId, restaurantId) => Promise.resolve(configs[restaurantId] ?? null),
    slotLoad: (restaurantId, from, to) => Promise.resolve(load(restaurantId, from, to)),
    createOrder(o): Promise<CreateOrderResult> {
      const summary = (x: StoredOrder) => ({
        id: x.id,
        number: x.number,
        status: x.status,
        totalCents: x.totals.totalCents,
        createdAt: x.createdAt,
      });
      const existing = orders.find(
        (x) => x.tenantId === o.tenantId && x.idempotencyKey === o.idempotencyKey,
      );
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
        number: counter,
        status: 'pending_payment',
        paymentIntentId: null,
        refundedCents: 0,
        createdAt: new Date().toISOString(),
        events: [],
      };
      event(stored, 'pending_payment', 'customer');
      orders.push(stored);
      return Promise.resolve({ ok: true, replayed: false, order: summary(stored) });
    },
  };

  const payments: PaymentStore = {
    getOrder(tenantId, orderId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (!o) return Promise.resolve(null);
      const r = restaurant(o);
      return Promise.resolve({
        id: o.id,
        tenantId: o.tenantId,
        restaurantId: o.restaurantId,
        number: o.number,
        status: o.status,
        totalCents: o.totals.totalCents,
        applicationFeeCents: o.applicationFeeCents,
        refundedCents: o.refundedCents,
        paymentIntentId: o.paymentIntentId,
        stripeAccountId: r?.stripeAccountId ?? null,
        stripeChargesEnabled:
          accounts.get(r?.stripeAccountId ?? '') ?? r?.stripeChargesEnabled ?? false,
        accessTokenHash: o.accessTokenHash,
      });
    },
    attachPaymentIntent(tenantId, orderId, pi) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (
        !o ||
        !['pending_payment', 'payment_failed'].includes(o.status) ||
        (o.paymentIntentId && o.paymentIntentId !== pi)
      ) {
        return Promise.resolve(false);
      }
      o.paymentIntentId = pi;
      return Promise.resolve(true);
    },
    markPaid(pi, amount, currency) {
      const o = byPi(pi);
      if (!o) return Promise.resolve({ ok: false, error: 'unknown_payment' });
      if (o.totals.totalCents !== amount || currency.toLowerCase() !== 'eur')
        return Promise.resolve({ ok: false, error: 'amount_mismatch' });
      if (!['pending_payment', 'payment_failed', 'cancelled'].includes(o.status)) {
        return Promise.resolve({ ok: true, orderId: o.id, tenantId: o.tenantId, changed: false });
      }
      o.status = 'paid';
      event(o, 'paid', 'stripe');
      return Promise.resolve({ ok: true, orderId: o.id, tenantId: o.tenantId, changed: true });
    },
    markPaymentFailed(pi) {
      const o = byPi(pi);
      if (!o) return Promise.resolve({ ok: false, error: 'unknown_payment' });
      if (o.status !== 'pending_payment')
        return Promise.resolve({ ok: true, orderId: o.id, tenantId: o.tenantId, changed: false });
      o.status = 'payment_failed';
      event(o, 'payment_failed', 'stripe');
      return Promise.resolve({ ok: true, orderId: o.id, tenantId: o.tenantId, changed: true });
    },
    expirePending(olderThan) {
      const expired = orders.filter(
        (o) =>
          ['pending_payment', 'payment_failed'].includes(o.status) &&
          new Date(o.createdAt) < olderThan,
      );
      for (const o of expired) {
        o.status = 'cancelled';
        event(o, 'cancelled', 'system');
      }
      return Promise.resolve(
        expired.map((o) => ({
          orderId: o.id,
          tenantId: o.tenantId,
          paymentIntentId: o.paymentIntentId,
          stripeAccountId: restaurant(o)?.stripeAccountId ?? null,
        })),
      );
    },
    recordRefund(tenantId, orderId, amount, actor) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (!o || !PAID.includes(o.status))
        return Promise.resolve({ ok: false, error: 'not_refundable' });
      if (amount <= 0 || o.refundedCents + amount > o.totals.totalCents)
        return Promise.resolve({ ok: false, error: 'amount_too_high' });
      o.refundedCents += amount;
      const full = o.refundedCents === o.totals.totalCents;
      if (full) o.status = 'refunded';
      event(o, full ? 'refunded' : 'partially_refunded', actor);
      return Promise.resolve({ ok: true, refundedCents: o.refundedCents, fullyRefunded: full });
    },
    setChargesEnabled(accountId, enabled) {
      accounts.set(accountId, enabled);
      return Promise.resolve();
    },
  };

  const reader: OrderReader = {
    getOrderDetail(tenantId, orderId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (!o) return Promise.resolve(null);
      const detail: OrderDetail = {
        id: o.id,
        tenantId: o.tenantId,
        restaurantId: o.restaurantId,
        number: o.number,
        status: o.status,
        mode: o.mode,
        requestedSlot: o.requestedSlot,
        estimatedAt: o.estimatedAt,
        createdAt: o.createdAt,
        totals: o.totals,
        refundedCents: o.refundedCents,
        customer: o.customer,
        deliveryAddress: o.deliveryAddress,
        lines: o.lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
          note: l.note,
          options: l.options.map((x) => ({ name: x.name, priceCents: x.priceCents })),
        })),
        events: o.events,
        accessTokenHash: o.accessTokenHash,
      };
      return Promise.resolve(detail);
    },
  };

  return { orders, ordering, payments, reader };
}
