import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'not_found',
  'tenant_suspended',
  'invalid_request',
  'menu_unavailable',
  'order_invalid',
  'slot_full',
  'unauthorized',
  'payments_unavailable',
  'order_not_payable',
  'internal_error',
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
