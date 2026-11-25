import {
  savedCardPaymentRequestSchema,
  type CardSetup,
  type SavedCardPayment,
} from '@splash360/contracts';
import type {
  MemberSessionStore,
  PaymentStore,
  StripeCustomerStore,
  TenantWithTheme,
} from '@splash360/db';
import type { Context, Hono } from 'hono';
import { apiError } from '../errors';
import { authenticateMember } from '../loyalty/service';
import type { CardGateway } from '../payments/cards';
import type { PaymentGateway } from '../payments/gateway';
import { bearer, tokenMatches } from '../payments/tokens';
import { checkReadiness, type HandshakeDeps } from '../pos/handshake';

export interface CardRoutesDeps {
  readonly cardGateway?: CardGateway | undefined;
  readonly stripeCustomers?: StripeCustomerStore | undefined;
  readonly gateway: PaymentGateway | null;
  readonly payments: PaymentStore;
  readonly handshake: HandshakeDeps;
  readonly tokenSecret: string;
  readonly memberSessions?: MemberSessionStore | undefined;
  readonly now: () => Date;
  /** Adresse de retour après une authentification 3-D Secure par redirection (app web). */
  readonly clientAppUrl?: string | undefined;
}

type Env = { Variables: { tenant: TenantWithTheme } };

const MEMBER_TOKEN = /^(m2\.[0-9a-f-]{36}\.[0-9a-z]{1,13}\.\d{1,6}\.[A-Za-z0-9_-]{20,100})$/i;
const CARD_ID = /^pm_[A-Za-z0-9]+$/;

/**
 * Cartes enregistrées des membres du club (lot 18, ADR 0023), montées sous /v1/tenants/:subdomain.
 * Un membre ne voit, ne supprime et n'utilise que les cartes de SON client Stripe : chaque carte
 * est revérifiée côté serveur avant toute action.
 */
export function registerCardRoutes(app: Hono<Env>, deps: CardRoutesDeps) {
  const memberOf = (c: Context<Env>, token: string | undefined) =>
    authenticateMember(deps, c.get('tenant').id, token);
  const fromAuthorization = (c: Context<Env>) =>
    /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];

  app.get('/:subdomain/loyalty/me/cards', async (c) => {
    const memberId = await memberOf(c, fromAuthorization(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    c.header('Cache-Control', 'no-store');
    if (!deps.cardGateway || !deps.stripeCustomers) return c.json({ cards: [] });
    const customerId = await deps.stripeCustomers.find(c.get('tenant').id, memberId);
    return c.json({ cards: customerId ? await deps.cardGateway.listCards(customerId) : [] });
  });

  app.post('/:subdomain/loyalty/me/cards/setup', async (c) => {
    const memberId = await memberOf(c, fromAuthorization(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    if (!deps.cardGateway || !deps.stripeCustomers)
      return apiError(c, 'payments_unavailable', 'Enregistrement de carte indisponible');
    const tenantId = c.get('tenant').id;
    let customerId = await deps.stripeCustomers.find(tenantId, memberId);
    if (!customerId) {
      const created = await deps.cardGateway.createCustomer({ tenantId, memberId });
      customerId = await deps.stripeCustomers.save(tenantId, memberId, created);
    }
    const body: CardSetup = {
      clientSecret: await deps.cardGateway.createSetup(customerId),
      publishableKey: deps.cardGateway.publishableKey,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, 201);
  });

  /** Carte du membre, revérifiée chez Stripe ; null si elle ne lui appartient pas. */
  async function ownedCard(c: Context<Env>, memberId: string, cardId: string) {
    if (!deps.cardGateway || !deps.stripeCustomers || !CARD_ID.test(cardId)) return null;
    const customerId = await deps.stripeCustomers.find(c.get('tenant').id, memberId);
    if (!customerId) return null;
    const owner = await deps.cardGateway.cardCustomer(cardId);
    return owner === customerId ? { customerId, cardId } : null;
  }

  app.delete('/:subdomain/loyalty/me/cards/:cardId', async (c) => {
    const memberId = await memberOf(c, fromAuthorization(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const card = await ownedCard(c, memberId, c.req.param('cardId'));
    // Même réponse qu'une carte inconnue : on ne révèle pas les cartes des autres.
    if (!card || !deps.cardGateway) return apiError(c, 'not_found', 'Carte inconnue');
    await deps.cardGateway.detach(card.cardId);
    return c.body(null, 204);
  });

  app.post('/:subdomain/loyalty/me/cards/:cardId/default', async (c) => {
    const memberId = await memberOf(c, fromAuthorization(c));
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const card = await ownedCard(c, memberId, c.req.param('cardId'));
    if (!card || !deps.cardGateway) return apiError(c, 'not_found', 'Carte inconnue');
    await deps.cardGateway.setDefault(card.customerId, card.cardId);
    return c.body(null, 204);
  });

  /**
   * Payer une commande avec une carte enregistrée : jeton de suivi de la commande (Authorization)
   * et jeton de membre (X-Member-Token). La commande ne passe à « payée » que par le webhook.
   */
  app.post('/:subdomain/orders/:orderId/payment/saved-card', async (c) => {
    const tenantId = c.get('tenant').id;
    const order = await deps.payments.getOrder(tenantId, c.req.param('orderId'));
    if (!order || !tokenMatches(bearer(c.req.header('Authorization')), order.accessTokenHash)) {
      return apiError(c, 'not_found', 'Commande inconnue');
    }
    const memberToken = MEMBER_TOKEN.exec(c.req.header('X-Member-Token') ?? '')?.[1];
    const memberId = await memberOf(c, memberToken);
    if (!memberId) return apiError(c, 'unauthorized', 'Session fidélité invalide');
    const input = savedCardPaymentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return apiError(c, 'invalid_request', 'Carte invalide');
    if (!deps.gateway || !deps.cardGateway || !order.stripeAccountId || !order.stripeChargesEnabled)
      return apiError(
        c,
        'payments_unavailable',
        'Paiement en ligne indisponible pour ce restaurant',
      );
    if (!['pending_payment', 'payment_failed'].includes(order.status))
      return apiError(c, 'order_not_payable', 'Cette commande ne peut plus être payée');
    // Jamais de débit avant que la caisse ait déclaré pouvoir accepter la commande (ADR 0018).
    const readiness = await checkReadiness(deps.handshake, tenantId, order.id);
    if (readiness === 'unavailable')
      return apiError(c, 'order_not_payable', 'Le restaurant n’a pas pu accepter cette commande');
    if (readiness === 'waiting')
      return apiError(c, 'pos_not_ready', 'Le restaurant n’a pas encore accepté la commande');
    const card = await ownedCard(c, memberId, input.data.paymentMethodId);
    if (!card) return apiError(c, 'not_found', 'Carte inconnue');

    // Même PaymentIntent que le paiement classique (une commande = un PaymentIntent).
    const intent = await deps.gateway.createPaymentIntent({
      orderId: order.id,
      tenantId,
      orderNumber: order.number,
      amountCents: order.totalCents,
      applicationFeeCents: order.applicationFeeCents,
      connectedAccountId: order.stripeAccountId,
    });
    if (!(await deps.payments.attachPaymentIntent(tenantId, order.id, intent.id)))
      return apiError(c, 'order_not_payable', 'Cette commande ne peut plus être payée');
    const status = await deps.cardGateway.payWithCard({
      paymentIntentId: intent.id,
      connectedAccountId: order.stripeAccountId,
      customerId: card.customerId,
      paymentMethodId: card.cardId,
      returnUrl: input.data.returnUrl ?? deps.clientAppUrl,
    });
    const body: SavedCardPayment = {
      status,
      clientSecret: intent.clientSecret,
      publishableKey: deps.gateway.publishableKey,
      stripeAccountId: order.stripeAccountId,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });
}
