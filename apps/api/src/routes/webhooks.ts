import { Hono } from 'hono';
import { InvalidWebhookSignature } from '../payments/gateway';
import { handlePaymentEvent, type PaymentDeps } from '../payments/service';

/**
 * Webhook Stripe (événements des comptes connectés). La signature est vérifiée sur le corps brut ;
 * seul ce webhook peut faire passer une commande à « payée » (règle non négociable n° 2).
 */
export function webhookRoutes(deps: PaymentDeps) {
  return new Hono().post('/stripe', async (c) => {
    if (!deps.gateway) return c.json({ received: false }, 503);
    const raw = await c.req.text();
    let event;
    try {
      event = await deps.gateway.parseWebhook(raw, c.req.header('stripe-signature'));
    } catch (error) {
      if (error instanceof InvalidWebhookSignature) return c.json({ received: false }, 400);
      throw error;
    }
    const outcome = await handlePaymentEvent(deps, event);
    // 2xx même pour un doublon ou un événement ignoré : Stripe ne doit pas le renvoyer.
    return c.json({ received: true, outcome });
  });
}
