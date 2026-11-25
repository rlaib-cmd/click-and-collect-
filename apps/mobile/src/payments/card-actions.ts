import { messages } from '@splash360/i18n';
import { loadStripe } from '@stripe/stripe-js';

export interface CardActionInput {
  readonly clientSecret: string;
  readonly publishableKey: string;
  readonly stripeAccountId: string;
}

/** Adresse de retour après 3-D Secure par redirection : la page en cours. */
export const cardReturnUrl = (): string | undefined =>
  typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? window.location.href
    : undefined;

/**
 * Version web : termine l'authentification 3-D Secure d'un paiement par carte enregistrée
 * (Stripe.js, compte du restaurant). Renvoie un message d'erreur, ou null si c'est fait.
 */
export async function completeCardAction(input: CardActionInput): Promise<string | null> {
  const stripe = await loadStripe(input.publishableKey, {
    stripeAccount: input.stripeAccountId,
    locale: 'fr',
  });
  if (!stripe) return messages.payment.failed;
  const result = await stripe.handleNextAction({ clientSecret: input.clientSecret });
  if (result.error) return result.error.message ?? messages.payment.failed;
  const status = result.paymentIntent?.status;
  return status === 'succeeded' || status === 'processing' ? null : messages.payment.failed;
}
