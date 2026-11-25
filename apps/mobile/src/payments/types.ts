import type { CardSetup, PaymentSession } from '@splash360/contracts';

export interface PaymentFormProps {
  readonly session: PaymentSession;
  readonly merchantName: string;
  /** Paiement confirmé côté Stripe : l'application attend maintenant la confirmation du serveur (webhook). */
  readonly onConfirmed: () => void;
}

export interface CardSetupFormProps {
  readonly setup: CardSetup;
  readonly merchantName: string;
  /** Carte confirmée par Stripe : la liste est relue depuis le serveur. */
  readonly onDone: () => void;
}
