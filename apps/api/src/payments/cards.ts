import Stripe from 'stripe';

/** Carte enregistrée telle que l'application l'affiche (jamais de numéro complet). */
export interface SavedCardView {
  readonly id: string;
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly isDefault: boolean;
}

export type SavedCardPaymentStatus = 'succeeded' | 'processing' | 'requires_action' | 'failed';

/**
 * Cartes enregistrées (lot 18, ADR 0023) : client Stripe et cartes sur la PLATEFORME ; au moment
 * de payer, la carte est clonée vers le compte du restaurant (paiement direct), comme le décrit
 * la documentation Stripe « Share payment methods across multiple accounts for direct charges ».
 */
export interface CardGateway {
  readonly publishableKey: string;
  createCustomer(input: { tenantId: string; memberId: string }): Promise<string>;
  /** SetupIntent sur la plateforme ; renvoie son client_secret. */
  createSetup(customerId: string): Promise<string>;
  listCards(customerId: string): Promise<SavedCardView[]>;
  /** Client Stripe auquel la carte est rattachée (null si inconnue ou détachée). */
  cardCustomer(paymentMethodId: string): Promise<string | null>;
  detach(paymentMethodId: string): Promise<void>;
  setDefault(customerId: string, paymentMethodId: string): Promise<void>;
  /** Clone la carte vers le compte du restaurant puis confirme le PaymentIntent de la commande. */
  payWithCard(input: {
    paymentIntentId: string;
    connectedAccountId: string;
    customerId: string;
    paymentMethodId: string;
    /** Retour après une authentification par redirection ; absent : géré par le SDK du client. */
    returnUrl?: string | undefined;
  }): Promise<SavedCardPaymentStatus>;
}

function statusOf(status: Stripe.PaymentIntent.Status): SavedCardPaymentStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'processing') return 'processing';
  if (status === 'requires_action') return 'requires_action';
  return 'failed';
}

export function createStripeCardGateway(options: {
  secretKey: string;
  publishableKey: string;
}): CardGateway {
  const stripe = new Stripe(options.secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  return {
    publishableKey: options.publishableKey,

    async createCustomer({ tenantId, memberId }) {
      const customer = await stripe.customers.create(
        { metadata: { tenant_id: tenantId, member_id: memberId } },
        // Deux requêtes simultanées pour le même membre ne créent qu'un client.
        { idempotencyKey: `cus-${tenantId}-${memberId}` },
      );
      return customer.id;
    },

    async createSetup(customerId) {
      const intent = await stripe.setupIntents.create({
        customer: customerId,
        allowed_payment_method_types: ['card'],
        usage: 'off_session',
      });
      if (!intent.client_secret) throw new Error('SetupIntent sans client_secret');
      return intent.client_secret;
    },

    async listCards(customerId) {
      const [methods, customer] = await Promise.all([
        stripe.customers.listPaymentMethods(customerId, { type: 'card', limit: 20 }),
        stripe.customers.retrieve(customerId),
      ]);
      const defaultId =
        'deleted' in customer && customer.deleted
          ? null
          : (() => {
              const d = customer.invoice_settings.default_payment_method;
              return typeof d === 'string' ? d : (d?.id ?? null);
            })();
      return methods.data.flatMap((m) =>
        m.card
          ? [
              {
                id: m.id,
                brand: m.card.brand,
                last4: m.card.last4,
                expMonth: m.card.exp_month,
                expYear: m.card.exp_year,
                isDefault: m.id === defaultId,
              },
            ]
          : [],
      );
    },

    async cardCustomer(paymentMethodId) {
      try {
        const m = await stripe.paymentMethods.retrieve(paymentMethodId);
        return typeof m.customer === 'string' ? m.customer : (m.customer?.id ?? null);
      } catch {
        return null;
      }
    },

    async detach(paymentMethodId) {
      await stripe.paymentMethods.detach(paymentMethodId);
    },

    async setDefault(customerId, paymentMethodId) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    },

    async payWithCard(input) {
      try {
        // Double clic ou nouvel essai : un paiement déjà lancé n'est jamais reconfirmé.
        const current = await stripe.paymentIntents.retrieve(input.paymentIntentId, undefined, {
          stripeAccount: input.connectedAccountId,
        });
        if (['succeeded', 'processing', 'requires_action'].includes(current.status)) {
          return statusOf(current.status);
        }
        const clone = await stripe.paymentMethods.create(
          { customer: input.customerId, payment_method: input.paymentMethodId },
          { stripeAccount: input.connectedAccountId },
        );
        const pi = await stripe.paymentIntents.confirm(
          input.paymentIntentId,
          {
            payment_method: clone.id,
            ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
          },
          { stripeAccount: input.connectedAccountId },
        );
        return statusOf(pi.status);
      } catch (error) {
        // Carte refusée, expirée… : le client choisit un autre moyen de paiement.
        if (error instanceof Stripe.errors.StripeCardError) return 'failed';
        throw error;
      }
    },
  };
}

/** Faux Stripe pour les tests : cartes en mémoire, appels mémorisés. */
export function createFakeCardGateway() {
  let customers = 0;
  const cards = new Map<string, { customer: string | null; view: SavedCardView }>();
  const defaults = new Map<string, string>();
  const payments: { paymentIntentId: string; account: string; card: string }[] = [];
  let nextStatus: SavedCardPaymentStatus = 'succeeded';
  const gateway: CardGateway = {
    publishableKey: 'pk_test_fake',
    createCustomer: () => Promise.resolve(`cus_fake${(customers += 1)}`),
    createSetup: (customerId) => Promise.resolve(`seti_${customerId}_secret_x`),
    listCards: (customerId) =>
      Promise.resolve(
        [...cards.values()]
          .filter((c) => c.customer === customerId)
          .map((c) => ({ ...c.view, isDefault: defaults.get(customerId) === c.view.id })),
      ),
    cardCustomer: (id) => Promise.resolve(cards.get(id)?.customer ?? null),
    detach(id) {
      const c = cards.get(id);
      if (c) c.customer = null;
      return Promise.resolve();
    },
    setDefault(customerId, id) {
      defaults.set(customerId, id);
      return Promise.resolve();
    },
    payWithCard(input) {
      payments.push({
        paymentIntentId: input.paymentIntentId,
        account: input.connectedAccountId,
        card: input.paymentMethodId,
      });
      return Promise.resolve(nextStatus);
    },
  };
  return {
    gateway,
    payments,
    /** Simule une carte ajoutée par le client via le SetupIntent. */
    addCard(customerId: string, id: string, last4 = '4242') {
      cards.set(id, {
        customer: customerId,
        view: { id, brand: 'visa', last4, expMonth: 12, expYear: 2034, isDefault: false },
      });
    },
    setNextStatus(s: SavedCardPaymentStatus) {
      nextStatus = s;
    },
  };
}
