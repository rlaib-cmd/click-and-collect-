import { z } from 'zod';

const cents = z.number().int().nonnegative();

export const orderModeSchema = z.enum(['pickup', 'delivery']);

export const availabilitySchema = z.object({
  modes: z.object({ pickup: z.boolean(), delivery: z.boolean() }),
  paused: z.boolean(),
  asap: z.discriminatedUnion('available', [
    z.object({ available: z.literal(true), estimatedAt: z.iso.datetime() }),
    z.object({ available: z.literal(false) }),
  ]),
  /** Jours proposés en commande planifiée (AAAA-MM-JJ, heure du restaurant). Vide = planification désactivée. */
  dates: z.array(z.iso.date()),
  timezone: z.string(),
  delivery: z
    .object({
      minimumCents: cents,
      freeThresholdCents: cents.nullable(),
    })
    .nullable(),
  serviceFeeCents: cents,
  /** Moyens de paiement proposés (ADR 0010) ; absent des anciennes réponses : en ligne seulement. */
  payment: z
    .object({ online: z.boolean(), onSite: z.boolean() })
    .default({ online: true, onSite: false }),
});

export const paymentMethodSchema = z.enum(['online', 'on_site']);

export const slotsSchema = z.object({
  date: z.iso.date(),
  slots: z.array(
    z.object({ at: z.iso.datetime(), label: z.string(), remaining: z.number().int().nullable() }),
  ),
});

export const addressSchema = z.object({
  label: z.string().min(3).max(200),
  postalCode: z.string().regex(/^\d{5}$/),
  city: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  instructions: z.string().max(200).nullable().optional(),
});

export const geoSearchSchema = z.object({
  results: z.array(addressSchema.omit({ instructions: true })),
});

export const deliveryCheckSchema = z.discriminatedUnion('deliverable', [
  z.object({ deliverable: z.literal(true), feeCents: cents, zoneId: z.string() }),
  z.object({ deliverable: z.literal(false) }),
]);

export const requestedTimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asap') }),
  z.object({ kind: z.literal('scheduled'), at: z.iso.datetime() }),
]);

export const cartLineSchema = z.object({
  productId: z.string().min(1).max(100),
  quantity: z.number().int(),
  optionIds: z.array(z.string().min(1).max(100)).max(30),
  note: z.string().max(500).nullable().optional(),
});

/** Ce que l'application envoie : jamais de montant (règle non négociable n° 1). */
export const quoteRequestSchema = z.object({
  mode: orderModeSchema,
  address: addressSchema.nullable(),
  requestedTime: requestedTimeSchema,
  lines: z.array(cartLineSchema).max(50),
  /** Membre connecté au club et récompense choisie (lot 8) ; jamais de montant ni de solde. */
  loyalty: z
    .object({
      memberToken: z.string().min(20).max(300),
      rewardId: z.string().min(1).max(100).nullable(),
      /** Produit choisi dans le palier (lot 11). */
      rewardProductId: z.string().min(1).max(100).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const pricedLineSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  options: z.array(z.object({ optionId: z.string(), name: z.string(), priceCents: cents })),
  unitPriceCents: cents,
  totalCents: cents,
  note: z.string().nullable(),
});

export const totalsSchema = z.object({
  subtotalCents: cents,
  deliveryFeeCents: cents,
  serviceFeeCents: cents,
  /** Récompense fidélité déduite (0 sans récompense ; absent des anciennes réponses). */
  discountCents: cents.default(0),
  totalCents: cents,
});

export const quoteSchema = z.object({
  lines: z.array(pricedLineSchema),
  totals: totalsSchema,
  /** Heure retenue (créneau ou estimation « dès que possible »). */
  at: z.iso.datetime(),
  /** Points que la commande rapportera et récompense appliquée ; null hors club. */
  loyalty: z
    .object({
      pointsEarned: z.number().int().nonnegative(),
      rewardId: z.string().nullable(),
      rewardProductId: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  /** Facultatif : le client est identifié par son téléphone (ADR 0013). Vide = pas d'e-mail. */
  email: z
    .union([z.email().max(200), z.literal('')])
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{10,20}$/, 'Numéro de téléphone invalide'),
  marketingConsent: z.boolean(),
});

export const placeOrderRequestSchema = quoteRequestSchema.extend({
  restaurantId: z.uuid(),
  customer: customerSchema,
  /** Généré par l'application, une fois par tentative de commande. */
  idempotencyKey: z.string().min(16).max(100),
  acceptedTerms: z.literal(true),
  /** Sur place : réservé aux membres du club (jeton dans `loyalty`) et aux restaurants qui l'acceptent. */
  paymentMethod: paymentMethodSchema.default('online'),
});

export const placedOrderSchema = z.object({
  orderId: z.uuid(),
  number: z.number().int(),
  status: z.string(),
  totals: totalsSchema,
  at: z.iso.datetime(),
  /** Jeton secret pour payer et suivre cette commande (en-tête Authorization: Bearer). */
  accessToken: z.string().min(20),
  paymentMethod: paymentMethodSchema.default('online'),
});

export const orderStatusSchema = z.enum([
  'pending_payment',
  'paid',
  'confirmed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'payment_failed',
  'cancelled',
  'refunded',
]);

/** Ce dont l'application a besoin pour afficher la feuille de paiement Stripe (paiement direct). */
export const paymentSessionSchema = z.object({
  clientSecret: z.string(),
  publishableKey: z.string(),
  /** Compte Stripe du restaurant : à passer à Stripe côté application pour un paiement direct. */
  stripeAccountId: z.string(),
  amountCents: cents,
});

export const orderTrackingSchema = z.object({
  orderId: z.uuid(),
  number: z.number().int(),
  paymentMethod: paymentMethodSchema.default('online'),
  /** Contenu du QR code à présenter au comptoir pour retrouver la commande. */
  pickupCode: z.string().default(''),
  status: orderStatusSchema,
  mode: orderModeSchema,
  estimatedAt: z.iso.datetime(),
  scheduled: z.boolean(),
  totals: totalsSchema,
  refundedCents: cents,
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int(),
      totalCents: cents,
      options: z.array(z.string()),
      note: z.string().nullable(),
    }),
  ),
  history: z.array(z.object({ status: z.string(), at: z.iso.datetime() })),
});

export type Availability = z.infer<typeof availabilitySchema>;
export type SlotsDto = z.infer<typeof slotsSchema>;
export type AddressDto = z.infer<typeof addressSchema>;
export type DeliveryCheck = z.infer<typeof deliveryCheckSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type Quote = z.infer<typeof quoteSchema>;
/** Ce que l'application envoie (moyen de paiement facultatif : en ligne par défaut). */
export type PlaceOrderRequest = z.input<typeof placeOrderRequestSchema>;
export type PlacedOrder = z.infer<typeof placedOrderSchema>;
export type PaymentSession = z.infer<typeof paymentSessionSchema>;
export type OrderTracking = z.infer<typeof orderTrackingSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type PaymentMethodDto = z.infer<typeof paymentMethodSchema>;
export type CustomerDto = z.infer<typeof customerSchema>;
