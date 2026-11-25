import { randomUUID } from 'node:crypto';
import {
  checkTransition,
  customerContactKey,
  reservedRewardPoints,
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
  type PosTicket,
  type PosTicketStore,
  type PromoAdminStore,
  type PromoRecord,
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
  /** Poignée de main avec la caisse (ADR 0018), comme les colonnes pos_* de Postgres. */
  pos?: { -readonly [K in keyof PosTicket]: PosTicket[K] };
  posOpeningAt?: Date;
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
  /** Codes promo (ADR 0015) et leurs utilisations, comme les tables Postgres. */
  const promos: (PromoRecord & { tenantId: string })[] = [];
  const redemptions: { promoId: string; contactKey: string; memberId: string | null }[] = [];
  let counter = 1000;
  const accounts = new Map<string, boolean>();
  const refundRequests = new Set<string>();

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
    findPromo: (tenantId, code) => {
      const p = promos.find((x) => x.tenantId === tenantId && x.code === code);
      return Promise.resolve(
        p ? { ...p, uses: redemptions.filter((r) => r.promoId === p.id).length } : null,
      );
    },
    promoUsedByMember: (promoId, memberId) =>
      Promise.resolve(redemptions.some((r) => r.promoId === promoId && r.memberId === memberId)),
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
      if (existing) {
        const sameCustomer =
          customerContactKey({ email: existing.customer.email, phone: existing.customer.phone }) ===
          customerContactKey({ email: o.customer.email, phone: o.customer.phone });
        if (existing.restaurantId !== o.restaurantId || !sameCustomer)
          return Promise.resolve({ ok: false, error: 'idempotency_conflict' });
        return Promise.resolve({ ok: true, replayed: true, order: summary(existing) });
      }
      if (o.loyalty?.reward && o.loyalty.balance !== undefined) {
        const memberId = o.loyalty.memberId;
        const reserved = reservedRewardPoints(
          orders
            .filter(
              (x) =>
                x.tenantId === o.tenantId &&
                x.loyalty?.memberId === memberId &&
                x.loyalty.reward !== null &&
                !x.loyaltySettled,
            )
            .map((x) => ({
              status: x.status as OrderStatus,
              points: x.loyalty?.reward?.costPoints ?? 0,
              createdAt: new Date(x.createdAt),
            })),
          new Date(),
        );
        if (reserved + o.loyalty.reward.costPoints > o.loyalty.balance)
          return Promise.resolve({ ok: false, error: 'insufficient_points' });
      }
      if (o.requestedSlot && o.maxOrdersPerSlot !== null) {
        const at = new Date(o.requestedSlot);
        if ((load(o.restaurantId, at, at)[o.requestedSlot] ?? 0) >= o.maxOrdersPerSlot) {
          return Promise.resolve({ ok: false, error: 'slot_full' });
        }
      }
      const contactKey =
        customerContactKey({ email: o.customer.email, phone: o.customer.phone }) ?? '';
      if (o.promo) {
        const p = promos.find((x) => x.id === o.promo?.id && x.tenantId === o.tenantId);
        const uses = redemptions.filter((r) => r.promoId === o.promo?.id);
        if (!p || (p.maxUses !== null && uses.length >= p.maxUses))
          return Promise.resolve({ ok: false, error: 'promo_exhausted' });
        const memberId = o.loyalty?.memberId ?? null;
        if (uses.some((r) => r.contactKey === contactKey || (memberId && r.memberId === memberId)))
          return Promise.resolve({ ok: false, error: 'promo_already_used' });
        redemptions.push({ promoId: p.id, contactKey, memberId });
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
      const lastCancel = [...o.events].reverse().find((e) => e.status === 'cancelled');
      const catchUp =
        ['pending_payment', 'payment_failed'].includes(o.status) ||
        (o.status === 'cancelled' && lastCancel?.actor === 'system'); // expiration seulement
      if (!catchUp) {
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
    hasRefundRequest(_tenantId, orderId, requestId) {
      return Promise.resolve(refundRequests.has(`${orderId}:${requestId}`));
    },
    recordRefund(tenantId, orderId, amount, actor, requestId) {
      const o = orders.find((x) => x.tenantId === tenantId && x.id === orderId);
      if (o && refundRequests.has(`${orderId}:${requestId}`))
        return Promise.resolve({
          ok: true,
          refundedCents: o.refundedCents,
          fullyRefunded: o.refundedCents === o.totals.totalCents,
        });
      if (!o || !PAID.includes(o.status))
        return Promise.resolve({ ok: false, error: 'not_refundable' });
      if (amount <= 0 || o.refundedCents + amount > o.totals.totalCents)
        return Promise.resolve({ ok: false, error: 'amount_too_high' });
      refundRequests.add(`${orderId}:${requestId}`);
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
          productId: l.productId,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
          note: l.note,
          options: l.options.map((x) => ({
            groupId: x.groupId,
            optionId: x.optionId,
            name: x.name,
            priceCents: x.priceCents,
          })),
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
    listFailedDispatches(tenantId, restaurantId) {
      const live = (orderId: string) => {
        const o = orders.find((x) => x.id === orderId);
        return !!o && (!restaurantId || o.restaurantId === restaurantId);
      };
      return Promise.resolve(
        [...dispatches.entries()]
          .filter(([id, d]) => d.tenantId === tenantId && d.status === 'failed' && live(id))
          .map(([orderId, d]) => ({
            orderId,
            number: orders.find((o) => o.id === orderId)?.number ?? 0,
            attempts: d.attempts,
            lastError: d.error,
            updatedAt: new Date().toISOString(),
          })),
      );
    },
    retryDispatch(tenantId, orderId, restaurantId) {
      const d = dispatches.get(orderId);
      const o = orders.find((x) => x.id === orderId);
      if (
        !d ||
        !o ||
        d.tenantId !== tenantId ||
        d.status !== 'failed' ||
        ['cancelled', 'refunded'].includes(o.status) ||
        (restaurantId && o.restaurantId !== restaurantId)
      )
        return Promise.resolve(false);
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

  const find = (tenantId: string, orderId: string) =>
    orders.find((x) => x.tenantId === tenantId && x.id === orderId);
  const tickets: PosTicketStore = {
    getTicket(tenantId, orderId) {
      const pos = find(tenantId, orderId)?.pos;
      return Promise.resolve(pos ? { ...pos } : null);
    },
    reserveOpening(tenantId, orderId, at) {
      const o = find(tenantId, orderId);
      if (!o || o.pos) return Promise.resolve(false);
      if (o.posOpeningAt && at.getTime() - o.posOpeningAt.getTime() < 30_000)
        return Promise.resolve(false);
      o.posOpeningAt = at;
      return Promise.resolve(true);
    },
    openTicket(tenantId, orderId, ticketId, at) {
      const o = find(tenantId, orderId);
      if (!o || o.pos) return Promise.resolve(false);
      o.pos = {
        ticketId,
        phase: 'waiting',
        openedAt: at,
        readyAt: null,
        paymentSentAt: null,
        confirmedAt: null,
        checkedAt: null,
        lastStatus: null,
        error: null,
      };
      return Promise.resolve(true);
    },
    setPhase(tenantId, orderId, phase, at, detail = {}) {
      const pos = find(tenantId, orderId)?.pos;
      if (pos) {
        pos.phase = phase;
        if (phase === 'ready') pos.readyAt = at;
        if (phase === 'payment_sent') pos.paymentSentAt = at;
        if (phase === 'confirmed') pos.confirmedAt = at;
        pos.checkedAt = at;
        pos.lastStatus = detail.lastStatus ?? pos.lastStatus;
        pos.error = detail.error ?? null;
      }
      return Promise.resolve();
    },
    recordCheck(tenantId, orderId, at, lastStatus) {
      const pos = find(tenantId, orderId)?.pos;
      if (pos) {
        pos.checkedAt = at;
        pos.lastStatus = lastStatus ?? pos.lastStatus;
      }
      return Promise.resolve();
    },
    cancelForPos(tenantId, orderId, reason) {
      const o = find(tenantId, orderId);
      if (!o || !['pending_payment', 'payment_failed', 'confirmed'].includes(o.status))
        return Promise.resolve(false);
      o.status = 'cancelled';
      event(o, 'cancelled', 'pos');
      void reason;
      return Promise.resolve(true);
    },
    deferDispatch(orderId, retryAt) {
      const d = dispatches.get(orderId);
      if (d)
        Object.assign(d, {
          status: 'pending',
          nextAt: retryAt.getTime(),
          attempts: Math.max(d.attempts - 1, 0),
        });
      return Promise.resolve();
    },
  };

  /** Codes promo au back-office (ADR 0015), sur les mêmes données que les commandes. */
  const promoAdmin: PromoAdminStore = {
    listPromos: (tenantId) =>
      Promise.resolve(
        promos
          .filter((p) => p.tenantId === tenantId)
          .map(({ tenantId: _t, ...p }) => ({
            ...p,
            uses: redemptions.filter((r) => r.promoId === p.id).length,
            createdAt: new Date(0).toISOString(),
          })),
      ),
    createPromo(tenantId, p) {
      if (promos.some((x) => x.tenantId === tenantId && x.code === p.code))
        return Promise.resolve('conflict' as const);
      const id = randomUUID();
      promos.push({ ...p, id, tenantId, uses: 0 });
      return Promise.resolve({ id });
    },
    setPromoActive(tenantId, promoId, active) {
      const p = promos.find((x) => x.tenantId === tenantId && x.id === promoId);
      if (!p) return Promise.resolve(false);
      Object.assign(p, { active });
      return Promise.resolve(true);
    },
  };

  return {
    orders,
    promos,
    promoAdmin,
    ordering,
    payments,
    reader,
    operations,
    dispatches,
    tickets,
  };
}
