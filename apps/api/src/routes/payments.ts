import type { OrderTracking, PaymentSession } from '@splash360/contracts';
import type { OperationsStore, OrderReader, PaymentStore, TenantWithTheme } from '@splash360/db';
import { z } from 'zod';
import type { Hono } from 'hono';
import { apiError } from '../errors';
import type { PaymentGateway } from '../payments/gateway';
import { bearer, tokenMatches } from '../payments/tokens';

export interface PaymentRoutesDeps {
  readonly operations: OperationsStore;
  readonly payments: PaymentStore;
  readonly orders: OrderReader;
  readonly gateway: PaymentGateway | null;
}

type Env = { Variables: { tenant: TenantWithTheme } };

/** Paiement et suivi d'une commande par son client (jeton de suivi obligatoire). */
export function registerPaymentRoutes(app: Hono<Env>, deps: PaymentRoutesDeps) {
  app.get('/:subdomain/orders/:orderId', async (c) => {
    const detail = await deps.orders.getOrderDetail(c.get('tenant').id, c.req.param('orderId'));
    // Même réponse qu'une commande inconnue : on ne révèle pas l'existence d'une commande.
    if (!detail || !tokenMatches(bearer(c.req.header('Authorization')), detail.accessTokenHash)) {
      return apiError(c, 'not_found', 'Commande inconnue');
    }
    const body: OrderTracking = {
      orderId: detail.id,
      number: detail.number,
      status: detail.status as OrderTracking['status'],
      mode: detail.mode,
      estimatedAt: detail.estimatedAt,
      scheduled: detail.requestedSlot !== null,
      totals: detail.totals,
      refundedCents: detail.refundedCents,
      lines: detail.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        totalCents: l.totalCents,
        options: l.options.map((o) => o.name),
        note: l.note,
      })),
      history: detail.events.map((e) => ({ status: e.status, at: e.at })),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  /** Jeton de notification push Expo de l'appareil qui suit la commande. */
  app.post('/:subdomain/orders/:orderId/push-token', async (c) => {
    const tenant = c.get('tenant');
    const detail = await deps.orders.getOrderDetail(tenant.id, c.req.param('orderId'));
    if (!detail || !tokenMatches(bearer(c.req.header('Authorization')), detail.accessTokenHash)) {
      return apiError(c, 'not_found', 'Commande inconnue');
    }
    const body = z
      .object({ token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return apiError(c, 'invalid_request', 'Jeton de notification invalide');
    await deps.operations.addPushToken(tenant.id, detail.id, body.data.token);
    return c.body(null, 204);
  });

  app.post('/:subdomain/orders/:orderId/payment', async (c) => {
    const order = await deps.payments.getOrder(c.get('tenant').id, c.req.param('orderId'));
    if (!order || !tokenMatches(bearer(c.req.header('Authorization')), order.accessTokenHash)) {
      return apiError(c, 'not_found', 'Commande inconnue');
    }
    if (!deps.gateway || !order.stripeAccountId || !order.stripeChargesEnabled) {
      return apiError(
        c,
        'payments_unavailable',
        'Paiement en ligne indisponible pour ce restaurant',
      );
    }
    if (!['pending_payment', 'payment_failed'].includes(order.status)) {
      return apiError(c, 'order_not_payable', 'Cette commande ne peut plus être payée');
    }
    const intent = await deps.gateway.createPaymentIntent({
      orderId: order.id,
      tenantId: order.tenantId,
      orderNumber: order.number,
      amountCents: order.totalCents,
      applicationFeeCents: order.applicationFeeCents,
      connectedAccountId: order.stripeAccountId,
    });
    if (!(await deps.payments.attachPaymentIntent(order.tenantId, order.id, intent.id))) {
      return apiError(c, 'order_not_payable', 'Cette commande ne peut plus être payée');
    }
    const body: PaymentSession = {
      clientSecret: intent.clientSecret,
      publishableKey: deps.gateway.publishableKey,
      stripeAccountId: order.stripeAccountId,
      amountCents: order.totalCents,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });
}
