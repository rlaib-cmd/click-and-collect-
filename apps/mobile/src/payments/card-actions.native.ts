import { messages } from '@splash360/i18n';
import { handleNextAction, initStripe } from '@stripe/stripe-react-native';
import * as Linking from 'expo-linking';
import type { CardActionInput } from './card-actions';

export type { CardActionInput } from './card-actions';

/** Retour dans l'application après une authentification par redirection. */
export const cardReturnUrl = (): string | undefined => Linking.createURL('stripe-redirect');

/**
 * Version iOS/Android : termine l'authentification 3-D Secure avec le SDK Stripe natif
 * (compte du restaurant). Renvoie un message d'erreur, ou null si c'est fait.
 */
export async function completeCardAction(input: CardActionInput): Promise<string | null> {
  await initStripe({
    publishableKey: input.publishableKey,
    stripeAccountId: input.stripeAccountId,
    urlScheme: Linking.createURL('/').split(':')[0] ?? 'splash360',
  });
  const result = await handleNextAction(input.clientSecret, cardReturnUrl());
  if (result.error) return result.error.message || messages.payment.failed;
  const status = String(result.paymentIntent.status).toLowerCase();
  return status === 'succeeded' || status === 'processing' ? null : messages.payment.failed;
}
