import { InvalidWebhookSignature, type PaymentEvent, type PaymentGateway } from './gateway';

/** Faux Stripe pour les tests : mémorise les appels, webhooks signés par un secret fixe. */
export function createFakeGateway(secret = 'whsec_test') {
  const created: {
    id: string;
    orderId: string;
    amountCents: number;
    applicationFeeCents: number;
    account: string;
  }[] = [];
  const cancelled: string[] = [];
  const refunds: { paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
  const accounts: string[] = [];
  const gateway: PaymentGateway = {
    publishableKey: 'pk_test_fake',
    createPaymentIntent(input) {
      // Idempotent par commande, comme l'implémentation Stripe.
      const existing = created.find((c) => c.orderId === input.orderId);
      if (existing)
        return Promise.resolve({ id: existing.id, clientSecret: `${existing.id}_secret` });
      const id = `pi_fake_${created.length + 1}`;
      created.push({
        id,
        orderId: input.orderId,
        amountCents: input.amountCents,
        applicationFeeCents: input.applicationFeeCents,
        account: input.connectedAccountId,
      });
      return Promise.resolve({ id, clientSecret: `${id}_secret` });
    },
    cancelPaymentIntent(id) {
      cancelled.push(id);
      return Promise.resolve();
    },
    refund(input) {
      refunds.push(input);
      return Promise.resolve();
    },
    createConnectedAccount(input) {
      accounts.push(input.restaurantId);
      return Promise.resolve(`acct_fake_${accounts.length}`);
    },
    createOnboardingLink(accountId, urls) {
      return Promise.resolve(
        `https://connect.stripe.test/setup/${accountId}?return=${encodeURIComponent(urls.returnUrl)}`,
      );
    },
    parseWebhook(rawBody, signature) {
      if (signature !== secret) throw new InvalidWebhookSignature();
      return JSON.parse(rawBody) as PaymentEvent;
    },
  };
  return { gateway, created, cancelled, refunds, accounts };
}
