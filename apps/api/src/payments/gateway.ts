import Stripe from 'stripe';

export interface CreatePaymentInput {
  readonly orderId: string;
  readonly tenantId: string;
  readonly orderNumber: number;
  readonly amountCents: number;
  readonly applicationFeeCents: number;
  /** Compte Stripe connecté du restaurant (paiement direct : le restaurant est le marchand). */
  readonly connectedAccountId: string;
}

export interface PaymentIntentRef {
  readonly id: string;
  readonly clientSecret: string;
}

/** Événement Stripe vérifié et réduit à ce dont l'application a besoin. */
export type PaymentEvent =
  | {
      readonly type: 'payment_succeeded';
      readonly paymentIntentId: string;
      readonly amountCents: number;
      readonly currency: string;
    }
  | { readonly type: 'payment_failed'; readonly paymentIntentId: string }
  | {
      readonly type: 'account_updated';
      readonly accountId: string;
      readonly chargesEnabled: boolean;
    }
  | { readonly type: 'ignored'; readonly stripeType: string };

export class InvalidWebhookSignature extends Error {
  constructor() {
    super('Signature de webhook Stripe invalide');
    this.name = 'InvalidWebhookSignature';
  }
}

/** Tout ce que l'application demande à Stripe passe par cette interface (testable sans réseau). */
export interface PaymentGateway {
  readonly publishableKey: string;
  createPaymentIntent(input: CreatePaymentInput): Promise<PaymentIntentRef>;
  cancelPaymentIntent(paymentIntentId: string, connectedAccountId: string): Promise<void>;
  refund(input: {
    paymentIntentId: string;
    connectedAccountId: string;
    amountCents: number;
    idempotencyKey: string;
    /** Rembourser aussi la commission Splash360 : seulement s'il y en a une (sinon Stripe refuse). */
    refundApplicationFee: boolean;
  }): Promise<void>;
  /** Vérifie la signature et décode l'événement ; lève `InvalidWebhookSignature` sinon. */
  /**
   * Vérifie la signature et traduit l'événement. Asynchrone : sur Supabase Edge (Deno), le SDK Stripe
   * ne peut vérifier la signature qu'avec SubtleCrypto, donc en asynchrone.
   */
  parseWebhook(rawBody: string, signature: string | undefined): Promise<PaymentEvent>;
  /** Crée le compte connecté d'un restaurant (paiements directs, le restaurant est le marchand). */
  createConnectedAccount(input: {
    restaurantId: string;
    tenantId: string;
    email: string | null;
    businessName: string;
  }): Promise<string>;
  /** Lien d'inscription hébergé par Stripe. */
  createOnboardingLink(
    accountId: string,
    urls: { refreshUrl: string; returnUrl: string },
  ): Promise<string>;
}

export function toPaymentEvent(event: Stripe.Event): PaymentEvent {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      return {
        type: 'payment_succeeded',
        paymentIntentId: pi.id,
        amountCents: pi.amount_received,
        currency: pi.currency,
      };
    }
    case 'payment_intent.payment_failed':
      return { type: 'payment_failed', paymentIntentId: event.data.object.id };
    case 'account.updated': {
      const account = event.data.object;
      return {
        type: 'account_updated',
        accountId: account.id,
        chargesEnabled: account.charges_enabled ?? false,
      };
    }
    default:
      return { type: 'ignored', stripeType: event.type };
  }
}

/**
 * Stripe Connect, paiements directs : le PaymentIntent est créé sur le compte du restaurant,
 * la commission Splash360 est prélevée via `application_fee_amount`.
 */
export function createStripeGateway(options: {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  /**
   * Domaines de l'app web (sans https://) à déclarer chez Stripe pour chaque restaurant :
   * sans cela, Apple Pay et Google Pay ne s'affichent pas sur le web (paiements directs).
   */
  paymentDomains?: readonly string[];
}): PaymentGateway {
  const stripe = new Stripe(options.secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  // SubtleCrypto (Web Crypto) : disponible sous Node 22 comme sous Deno (Supabase Edge).
  const cryptoProvider = Stripe.createSubtleCryptoProvider();
  return {
    publishableKey: options.publishableKey,

    async createPaymentIntent(input) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: 'eur',
          automatic_payment_methods: { enabled: true },
          ...(input.applicationFeeCents > 0
            ? { application_fee_amount: input.applicationFeeCents }
            : {}),
          description: `Commande n° ${input.orderNumber}`,
          metadata: {
            order_id: input.orderId,
            tenant_id: input.tenantId,
            order_number: String(input.orderNumber),
          },
        },
        // Une commande = un seul PaymentIntent, même en cas de double clic.
        { stripeAccount: input.connectedAccountId, idempotencyKey: `pi-${input.orderId}` },
      );
      if (!pi.client_secret) throw new Error('PaymentIntent sans client_secret');
      return { id: pi.id, clientSecret: pi.client_secret };
    },

    async cancelPaymentIntent(paymentIntentId, connectedAccountId) {
      await stripe.paymentIntents.cancel(
        paymentIntentId,
        {},
        { stripeAccount: connectedAccountId },
      );
    },

    async refund(input) {
      await stripe.refunds.create(
        // La commission Splash360 est remboursée au prorata : le restaurant ne paie pas de commission sur un remboursement.
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountCents,
          // Sans commission prélevée, Stripe refuse `refund_application_fee` (constaté le 25/11).
          ...(input.refundApplicationFee ? { refund_application_fee: true } : {}),
        },
        { stripeAccount: input.connectedAccountId, idempotencyKey: input.idempotencyKey },
      );
    },

    async createConnectedAccount(input) {
      // Configuration recommandée par Stripe pour une plateforme logicielle à paiements directs :
      // le restaurant paie les frais Stripe et porte les litiges, avec son propre tableau de bord.
      // À revalider avec la documentation Connect au moment de l'ouverture du compte plateforme.
      const account = await stripe.accounts.create(
        {
          country: 'FR',
          ...(input.email ? { email: input.email } : {}),
          business_profile: { name: input.businessName },
          controller: {
            fees: { payer: 'account' },
            losses: { payments: 'stripe' },
            stripe_dashboard: { type: 'full' },
          },
          metadata: { restaurant_id: input.restaurantId, tenant_id: input.tenantId },
        },
        { idempotencyKey: `account-${input.restaurantId}` },
      );
      return account.id;
    },

    async createOnboardingLink(accountId, urls) {
      // Apple Pay / Google Pay sur le web : domaines déclarés sur le compte du restaurant.
      // Idempotent côté métier : un domaine déjà déclaré renvoie une erreur ignorée ici.
      for (const domain of options.paymentDomains ?? []) {
        await stripe.paymentMethodDomains
          .create({ domain_name: domain }, { stripeAccount: accountId })
          .catch(() => undefined);
      }
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        refresh_url: urls.refreshUrl,
        return_url: urls.returnUrl,
      });
      return link.url;
    },

    async parseWebhook(rawBody, signature) {
      if (!signature) throw new InvalidWebhookSignature();
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          rawBody,
          signature,
          options.webhookSecret,
          undefined,
          cryptoProvider,
        );
      } catch {
        throw new InvalidWebhookSignature();
      }
      return toPaymentEvent(event);
    },
  };
}
