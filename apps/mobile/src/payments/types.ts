import type { PaymentSession } from '@splash360/contracts';

export interface PaymentFormProps {
  readonly session: PaymentSession;
  readonly merchantName: string;
  /** Paiement confirmé côté Stripe : l'application attend maintenant la confirmation du serveur (webhook). */
  readonly onConfirmed: () => void;
}
