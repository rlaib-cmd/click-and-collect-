import { z } from 'zod';

/**
 * Cartes enregistrées (lot 18, ADR 0023) : seuls des identifiants Stripe et des informations
 * d'affichage (marque, 4 derniers chiffres, expiration) circulent ; jamais de numéro de carte.
 */
export const savedCardSchema = z.object({
  id: z.string().regex(/^pm_[A-Za-z0-9]+$/),
  brand: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int(),
  isDefault: z.boolean(),
});
export type SavedCard = z.infer<typeof savedCardSchema>;

/** GET /v1/tenants/{subdomain}/loyalty/me/cards */
export const savedCardsSchema = z.object({ cards: z.array(savedCardSchema) });

/** POST …/loyalty/me/cards/setup : SetupIntent créé sur la plateforme pour ajouter une carte. */
export const cardSetupSchema = z.object({
  clientSecret: z.string().min(10),
  publishableKey: z.string().startsWith('pk_'),
});
export type CardSetup = z.infer<typeof cardSetupSchema>;

/** POST /v1/tenants/{subdomain}/orders/{orderId}/payment/saved-card */
export const savedCardPaymentRequestSchema = z.object({
  paymentMethodId: savedCardSchema.shape.id,
  /** Retour après 3-D Secure par redirection : page web en https ou schéma de l'application. */
  returnUrl: z
    .string()
    .max(500)
    .regex(/^(https:\/\/|(?!javascript:|data:|file:|vbscript:|http:)[a-z][a-z0-9+.-]*:\/\/)\S+$/i)
    .optional(),
});
export type SavedCardPaymentRequest = z.infer<typeof savedCardPaymentRequestSchema>;

/**
 * Résultat : `requires_action` → l'application termine l'authentification (3-D Secure) avec
 * Stripe ; la commande ne passe à « payée » que par le webhook Stripe (règle n° 2).
 */
export const savedCardPaymentSchema = z.object({
  status: z.enum(['succeeded', 'processing', 'requires_action', 'failed']),
  clientSecret: z.string().min(10),
  publishableKey: z.string().startsWith('pk_'),
  stripeAccountId: z.string().startsWith('acct_'),
});
export type SavedCardPayment = z.infer<typeof savedCardPaymentSchema>;
