import {
  checkTransition,
  type OperationalStatus,
  type OrderStatus,
  type SlotLoad,
} from '@splash360/core';
import {
  SLOT_HOLDING_STATUSES,
  type CreateOrderResult,
  type NewOrder,
  type OrderDetail,
  type OperationsStore,
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
  posReference?: string;
  loyaltySettled?: boolean;
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
    rewardHolds: (tenantId, memberId, exceptIdempotencyKey) =>
      Promise.resolve(
        orders
          .filter(
            (o) =>
              o.tenantId === tenantId &&
              o.loyalty?.memberId === memberId &&
              o.loyalty.reward !== null &&
              !o.loyaltySettled &&
              o.idempotencyKey !== exceptIdempotencyKey,
          )
          .map((o) => ({
            status: o.status as OrderStatus,
            points: o.loyalty?.reward?.costPoints ?? 0,
            createdAt: new Date(o.createdAt),
          })),
      ),
    memberOrders: (tenantId, memberId, page) =>
      Promise.resolve(
        orders
          .filter(
            (o) =>
              o.tenantId === tenantId &&
              o.loyalty?.memberId === memberId &&
              (page.beforeNumber === null || o.number < page.beforeNumber),
          )
          .sort((a, b) => b.number - a.number)
          .slice(0, page.limit)
          .map((o) => ({
            id: o.id,
            number: o.number,
            status: o.status as OrderStatus,
            mode: o.mode,
            paymentMethod:
              o.paymentMethod === 'on_site' ? ('on_site' as const) : ('online' as const),
            totalCents: o.totals.totalCents,
            createdAt: o.createdAt,
            restaurantId: o.restaurantId,
            restaurantName: restaurants().find((r) => r.id === o.restaurantId)?.name ?? '',
            items: o.lines.map((l) => ({
              name: l.name,
              quantity: l.quantity,
              productId: l.productId,
              optionIds: l.options.map((x) => x.optionId),
              note: l.note,
            })),
          })),
      ),
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
      const onSite = o.paymentMethod === 'on_site';
      const stored: StoredOrder = {
        ...o,
        number: counter,
        status: onSite ? 'confirmed' : 'pending_payment',
        paymentIntentId: null,
        refundedCents: 0,
        createdAt: new Date().toISOString(),
        events: [],
      };
      event(stored, onSite ? 'confirmed' : 'pending_payment', 'customer');
      orders.push(stored);
      // Sur place : envoi en caisse créé avec la commande, comme la transaction Postgres.
      if (onSite) newDispatch(stored.id, stored.tenantId);
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
    markLoyaltySettled(tenantId, orderId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (o) o.loyaltySettled = true;
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
        paymentMethod: o.paymentMethod ?? 'online',
        loyalty: o.loyalty
          ? {
              memberId: o.loyalty.memberId,
              rewardId: o.loyalty.reward?.id ?? null,
              rewardPoints: o.loyalty.reward?.costPoints ?? null,
              settled: o.loyaltySettled ?? false,
            }
          : null,
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

  const dispatches = new Map<
    string,
    {
      tenantId: string;
      status: 'pending' | 'sent' | 'failed';
      attempts: number;
      nextAt: number;
      error: string | null;
    }
  >();
  function newDispatch(orderId: string, tenantId: string) {
    if (dispatches.has(orderId)) return;
    dispatches.set(orderId, { tenantId, status: 'pending', attempts: 0, nextAt: 0, error: null });
  }
  const pushTokens = new Map<string, Set<string>>();

  // Le passage à « payée » crée l'envoi à la caisse, comme la transaction Postgres.
  const markPaid = payments.markPaid.bind(payments);
  payments.markPaid = async (pi, amount, currency) => {
    const result = await markPaid(pi, amount, currency);
    if (result.ok && result.changed) newDispatch(result.orderId, result.tenantId);
    return result;
  };

  const operations: OperationsStore = {
    claimDueDispatches(limit) {
      const now = Date.now();
      const due = [...dispatches.entries()]
        .filter(([, d]) => d.status === 'pending' && d.nextAt <= now)
        .slice(0, limit);
      return Promise.resolve(
        due.map(([orderId, d]) => {
          d.attempts += 1;
          d.nextAt = now + 120_000;
          return { orderId, tenantId: d.tenantId, attempts: d.attempts };
        }),
      );
    },
    markDispatched(orderId, reference) {
      const d = dispatches.get(orderId);
      if (d) d.status = 'sent';
      const o = orders.find((x) => x.id === orderId);
      if (o) o.posReference = reference;
      return Promise.resolve();
    },
    markDispatchFailed(orderId, error, retryAt) {
      const d = dispatches.get(orderId);
      if (d) {
        d.error = error;
        d.status = retryAt ? 'pending' : 'failed';
        if (retryAt) d.nextAt = retryAt.getTime();
      }
      return Promise.resolve();
    },
    listFailedDispatches(tenantId) {
      return Promise.resolve(
        [...dispatches.entries()]
          .filter(([, d]) => d.tenantId === tenantId && d.status === 'failed')
          .map(([orderId, d]) => ({
            orderId,
            number: orders.find((o) => o.id === orderId)?.number ?? 0,
            attempts: d.attempts,
            lastError: d.error,
            updatedAt: new Date().toISOString(),
          })),
      );
    },
    retryDispatch(tenantId, orderId) {
      const d = dispatches.get(orderId);
      if (!d || d.tenantId !== tenantId || d.status !== 'failed') return Promise.resolve(false);
      Object.assign(d, { status: 'pending', attempts: 0, nextAt: 0 });
      return Promise.resolve(true);
    },
    changeStatus(tenantId, orderId, to: OperationalStatus, actor) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (!o) return Promise.resolve({ ok: false, error: 'not_found' });
      const from = o.status as OrderStatus;
      const check = checkTransition(o.mode, from, to);
      if (!check.ok) return Promise.resolve({ ok: false, error: check.error });
      o.status = to;
      event(o, to, actor);
      return Promise.resolve({ ok: true, from, to, tenantId, orderId });
    },
    findByPosReference(reference) {
      const o = orders.find((x) => x.posReference === reference);
      return Promise.resolve(o ? { tenantId: o.tenantId, orderId: o.id } : null);
    },
    addPushToken(tenantId, orderId, token) {
      if (!orders.some((x) => x.tenantId === tenantId && x.id === orderId))
        return Promise.reject(new Error('tenant_id incohérent'));
      const set = pushTokens.get(orderId) ?? new Set<string>();
      set.add(token);
      pushTokens.set(orderId, set);
      return Promise.resolve();
    },
    listPushTokens(_tenantId, orderId) {
      return Promise.resolve([...(pushTokens.get(orderId) ?? [])]);
    },
  };

  return { orders, ordering, payments, reader, operations, dispatches };
}
