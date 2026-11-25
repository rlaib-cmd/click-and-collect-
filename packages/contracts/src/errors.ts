import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'not_found',
  'tenant_suspended',
  'invalid_request',
  'menu_unavailable',
  'order_invalid',
  'slot_full',
  'unauthorized',
  'forbidden',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'payments_unavailable',
  'order_not_payable',
  'internal_error',
  // Connexion du client par code (lot 10)
  'otp_invalid',
  'otp_expired',
  'storage_unavailable',
  // Caisse Splash360 (lot 14) : pas encore prête, le paiement attend
  'pos_not_ready',
  'client_outdated',
]);

/** Problème précis sur une commande, pour guider le client (retour au panier avec un message clair). */
export const orderIssueSchema = z.object({
  code: z.enum([
    // Panier
    'empty_cart',
    'too_many_lines',
    'unknown_product',
    'product_unavailable',
    'invalid_quantity',
    'unknown_option',
    'option_unavailable',
    'duplicate_option',
    'too_few_options',
    'too_many_options',
    'note_too_long',
    // Mode, adresse, montant
    'mode_unavailable',
    'restaurant_paused',
    'address_required',
    'out_of_delivery_zone',
    'below_delivery_minimum',
    // Heure
    'restaurant_closed',
    'scheduling_disabled',
    'slot_unavailable',
    'menu_outdated',
    // Fidélité
    'loyalty_session_invalid',
    'unknown_reward',
    'reward_product_missing',
    'reward_product_not_eligible',
    'insufficient_points',
    'reward_needs_paid_items',
    // Code promo (lot 11)
    'promo_invalid',
    'promo_not_started',
    'promo_expired',
    'promo_min_subtotal',
    'promo_exhausted',
    'promo_already_used',
    'promo_needs_paid_amount',
    // Paiement
    'payment_method_unavailable',
    'on_site_requires_member',
  ]),
  line: z.number().int().nonnegative().optional(),
  productId: z.string().optional(),
  groupId: z.string().optional(),
  optionId: z.string().optional(),
  missingCents: z.number().int().optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    issues: z.array(orderIssueSchema).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type OrderIssue = z.infer<typeof orderIssueSchema>;
