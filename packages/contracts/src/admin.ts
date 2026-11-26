import { z } from 'zod';
import { menuSchema } from './menu';
import { orderStatusSchema, totalsSchema } from './ordering';
import { subdomainSchema, tenantThemeSchema } from './tenant';

const cents = z.number().int().nonnegative();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const staffRoleSchema = z.enum(['super_admin', 'tenant_admin', 'manager', 'staff']);
/** Rôles qu'une enseigne attribue (ADR 0017) : propriétaire, gérant, équipier. */
export const tenantRoleSchema = z.enum(['tenant_admin', 'manager', 'staff']);

export const meSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  role: staffRoleSchema,
  /** Enseigne courante (choisie par le super-administrateur, imposée sinon). */
  tenant: z
    .object({
      id: z.uuid(),
      name: z.string(),
      subdomain: z.string(),
      /** Tuile de marque du studio (version publiée). */
      logoUrl: z.string().nullable().default(null),
      primaryColor: z.string().default('#3730A3'),
      status: z.enum(['active', 'suspended']).default('active'),
    })
    .nullable(),
  restaurantId: z.uuid().nullable(),
});

export const adminRestaurantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
  status: z.enum(['active', 'paused', 'closed']),
  stripeAccountId: z.string().nullable(),
  stripeChargesEnabled: z.boolean(),
  /** Branché sur la vraie carte et la vraie caisse Splash360 (ADR 0018). */
  splash360Live: z.boolean().default(false),
  /** Station click and collect Splash360 des webhooks (lot 23) ; null : non réglée. */
  splash360StationId: z.string().nullable().default(null),
  /** États reçus de la caisse : articles hors stock, prix de livraison propres (lot 23). */
  stock: z
    .object({ unavailable: z.number().int(), deliveryPrices: z.number().int() })
    .default({ unavailable: 0, deliveryPrices: 0 }),
});

/** Identifiant client de la station Splash360 (dernier segment du chemin des webhooks). */
export const splash360StationSchema = z.object({
  stationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,100}$/)
    .nullable(),
});

/** Journal « Webhooks reçus » du super-administrateur (lot 23) : aucune donnée personnelle. */
export const splash360WebhookLogSchema = z.object({
  /** Secrets de signature posés sur le serveur. */
  configured: z.boolean(),
  receipts: z.array(
    z.object({
      webhookId: z.string(),
      event: z.enum(['stock', 'prices', 'catalog', 'orders']),
      stationId: z.string(),
      restaurantId: z.string().nullable(),
      outcome: z.enum([
        'received',
        'applied',
        'ignored',
        'test',
        'unknown_station',
        'unknown_order',
        'failed',
      ]),
      summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
      receivedAt: z.iso.datetime(),
      processedAt: z.iso.datetime().nullable(),
    }),
  ),
});

/** Avancement de la commande dans la caisse Splash360 (ADR 0018). */
export const posPhaseSchema = z.enum(['waiting', 'ready', 'payment_sent', 'confirmed', 'failed']);

/** Résultat du test de connexion à Splash360. */
export const splash360TestSchema = z.union([
  z.object({ ok: z.literal(true), products: z.number().int(), categories: z.number().int() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

export const adminOrderSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  restaurantId: z.uuid(),
  status: orderStatusSchema,
  mode: z.enum(['pickup', 'delivery']),
  customerName: z.string(),
  totalCents: cents,
  estimatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  itemCount: z.number().int(),
  /** Sur place : à encaisser au comptoir (ADR 0010). */
  paymentMethod: z.enum(['online', 'on_site']).default('online'),
  posPhase: posPhaseSchema.nullable().default(null),
});

export const adminOrderDetailSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  restaurantId: z.uuid(),
  status: orderStatusSchema,
  mode: z.enum(['pickup', 'delivery']),
  estimatedAt: z.iso.datetime(),
  scheduled: z.boolean(),
  totals: totalsSchema,
  refundedCents: cents,
  customer: z.object({ name: z.string(), email: z.string().nullable(), phone: z.string() }),
  deliveryAddress: z
    .object({
      label: z.string(),
      postalCode: z.string(),
      city: z.string(),
      instructions: z.string().nullable().optional(),
    })
    .nullable(),
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int(),
      totalCents: cents,
      options: z.array(z.string()),
      note: z.string().nullable(),
      /** Promotions de catalogue de la caisse sur la ligne (lot 24). */
      discounts: z
        .array(z.object({ name: z.string(), units: z.number().int(), cents }))
        .default([]),
    }),
  ),
  /** Remise et frais des promotions de catalogue sur toute la commande (lot 24). */
  adjustments: z
    .array(z.object({ name: z.string(), kind: z.enum(['discount', 'fee']), cents }))
    .default([]),
  history: z.array(
    z.object({
      status: z.string(),
      actor: z.string(),
      at: z.iso.datetime(),
      /** Motif saisi en caisse (annulation reçue de Splash360, lot 23). */
      note: z.string().nullable().optional(),
    }),
  ),
});

export const statusChangeSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']),
});

export const refundRequestSchema = z.object({
  amountCents: z.number().int().positive(),
  /** Identifiant unique de la demande (idempotence en cas de double clic). */
  requestId: z.string().min(8).max(64),
});

export const settingsSchema = z
  .object({
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    /** Paiement sur place, réservé aux membres du club (ADR 0010). */
    payOnSiteEnabled: z.boolean().default(false),
    prepMinutes: z.number().int().min(0).max(240),
    deliveryMinutes: z.number().int().min(0).max(240),
    slotStepMinutes: z.union([z.literal(10), z.literal(15), z.literal(30)]),
    maxOrdersPerSlot: z.number().int().positive().nullable(),
    daysAhead: z.number().int().min(0).max(30),
    deliveryMinimumCents: cents,
    freeDeliveryThresholdCents: cents.nullable(),
    serviceFeeCents: cents,
    openingHours: z
      .array(z.object({ isoWeekday: z.number().int().min(1).max(7), opens: hhmm, closes: hhmm }))
      .max(50)
      .refine(
        (h) => h.every((r) => r.closes > r.opens),
        'Chaque plage doit fermer après son ouverture',
      ),
    closures: z
      .array(z.object({ day: z.iso.date(), reason: z.string().max(100).nullable() }))
      .max(100),
    zones: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          kind: z.enum(['radius', 'postal_codes']),
          radiusMeters: z.number().int().positive().max(50_000).nullable(),
          postalCodes: z.array(z.string().regex(/^\d{5}$/)).max(200),
          feeCents: cents,
        }),
      )
      .max(20),
  })
  .refine((s) => s.pickupEnabled || s.deliveryEnabled, 'Activez au moins un mode de commande');

export const themeUpdateSchema = tenantThemeSchema;

/** Studio design (lot 12) : version publiée et brouillon en attente (null : aucun). */
export const themeDraftStateSchema = z.object({
  live: tenantThemeSchema,
  draft: tenantThemeSchema.nullable(),
  draftUpdatedAt: z.iso.datetime().nullable(),
});
export type ThemeDraftState = z.infer<typeof themeDraftStateSchema>;

/** Lien d'aperçu du brouillon dans la vraie application (30 minutes). */
export const themePreviewLinkSchema = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});

export const logoUploadResultSchema = z.object({ logoUrl: z.url() });

export const legalSchema = z.object({ text: z.string().max(50_000).nullable() });

export const menuOverrideSchema = z.object({
  kind: z.enum(['category', 'product']),
  itemId: z.string().min(1).max(100),
  hidden: z.boolean(),
  position: z.number().int().min(0).max(10_000).nullable(),
  /**
   * Produit mis en avant sur l'accueil. Absent d'une écriture : la valeur enregistrée est gardée
   * (les écrans qui ne règlent que pause/ordre ne l'effacent pas). Toujours présent en lecture.
   */
  featured: z.boolean().optional(),
});

export const adminMenuSchema = menuSchema.extend({
  overrides: z.array(menuOverrideSchema),
  warnings: z.array(
    z.object({ productId: z.string(), name: z.string(), issue: z.enum(['no_photo', 'no_price']) }),
  ),
});

export const dashboardSchema = z.object({
  revenueCents: z.number().int(),
  orders: z.number().int(),
  averageBasketCents: z.number().int(),
  byMode: z.object({ pickup: z.number().int(), delivery: z.number().int() }),
  byDay: z.array(
    z.object({ day: z.string(), orders: z.number().int(), revenueCents: z.number().int() }),
  ),
  byRestaurant: z.array(
    z.object({
      restaurantId: z.string(),
      name: z.string(),
      orders: z.number().int(),
      revenueCents: z.number().int(),
    }),
  ),
});

export const customerRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string(),
  marketingConsent: z.boolean(),
  orders: z.number().int(),
  spentCents: z.number().int(),
  lastOrderAt: z.iso.datetime().nullable(),
});

export const staffMemberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: staffRoleSchema,
  restaurantId: z.uuid().nullable(),
  disabled: z.boolean(),
  /** Invité, pas encore connecté. */
  pending: z.boolean(),
});

/** Modification d'un compte d'équipe : activation, rôle et restaurant. */
export const staffUpdateSchema = z
  .object({
    disabled: z.boolean().optional(),
    role: tenantRoleSchema.optional(),
    restaurantId: z.uuid().nullable().optional(),
  })
  .refine((u) => u.disabled !== undefined || u.role !== undefined, 'Rien à modifier')
  .refine(
    (u) => u.role !== 'staff' || (u.restaurantId !== undefined && u.restaurantId !== null),
    'Un équipier est rattaché à un restaurant',
  );

/** Réponse d'une invitation : false si l'e-mail n'a pas pu partir (compte créé quand même). */
export const invitationSchema = z.object({ invitationSent: z.boolean() });

export const inviteSchema = z
  .object({
    email: z.email().max(200),
    name: z.string().max(100).nullable(),
    role: tenantRoleSchema,
    restaurantId: z.uuid().nullable(),
  })
  .refine(
    (i) => i.role !== 'staff' || i.restaurantId !== null,
    'Un équipier est rattaché à un restaurant',
  );

export const tenantSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subdomain: z.string(),
  splash360Id: z.string(),
  status: z.enum(['active', 'suspended']),
  applicationFeeBps: z.number().int(),
  applicationFeeFixedCents: z.number().int(),
  restaurants: z.number().int(),
  hasDraft: z.boolean().default(false),
  ownerActive: z.boolean().default(false),
  primaryColor: z.string().nullable().default(null),
  logoUrl: z.string().nullable().default(null),
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  subdomain: subdomainSchema,
  splash360Id: z.string().trim().min(1).max(100),
  adminEmail: z.email().max(200),
});

export const updateTenantSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  applicationFeeBps: z.number().int().min(0).max(3000).optional(),
  applicationFeeFixedCents: cents.optional(),
});

/** Membre du club fidélité vu depuis le back-office (lot 9). */
export const clubMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  /** Mobile (+33…), identifiant principal en caisse (lot 10). */
  phone: z.string().nullable(),
  points: z.number().int(),
  cardCode: z.string(),
  createdAt: z.string(),
});

/** Correction manuelle des points, avec son motif (visible dans l'historique du client). */
export const pointsAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0),
  reason: z.string().trim().min(2).max(120),
});

export const alertSchema = z.object({
  orderId: z.uuid(),
  number: z.number().int(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Commande annulée ici, peut-être « en attente » en caisse : à annuler en caisse (26/11). */
export const posToCancelSchema = z.object({
  orderId: z.uuid(),
  number: z.number().int(),
  cancelledAt: z.iso.datetime(),
});

export const alertsResponseSchema = z.object({
  alerts: z.array(alertSchema),
  posToCancel: z.array(posToCancelSchema).default([]),
});

export type Me = z.infer<typeof meSchema>;
export type AdminRestaurant = z.infer<typeof adminRestaurantSchema>;
export type Splash360WebhookLog = z.infer<typeof splash360WebhookLogSchema>;
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export type SettingsDto = z.infer<typeof settingsSchema>;
export type AdminMenu = z.infer<typeof adminMenuSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type CustomerRowDto = z.infer<typeof customerRowSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;
export type TenantSummaryDto = z.infer<typeof tenantSummarySchema>;
export type AlertDto = z.infer<typeof alertSchema>;
/** Lot 21 : réglages du programme que l'API YouFID ne fournit pas (défauts 10 et 100). */
export const loyaltySettingsSchema = z.object({
  pointsPerEuro: z.number().int().min(0).max(1000),
  welcomePoints: z.number().int().min(0).max(100_000),
});

/** GET /v1/admin/loyalty/settings : `source` « youfid » quand les réglages sont utilisés. */
export const loyaltySettingsResponseSchema = loyaltySettingsSchema.extend({
  source: z.enum(['demo', 'youfid']),
});

/** Lot 21 : opération de points envoyée à YouFID, refusée ou à l'issue inconnue. */
export const loyaltyOperationSchema = z.object({
  id: z.string(),
  kind: z.enum(['earn', 'redeem', 'welcome', 'bonus', 'adjust']),
  memberId: z.string(),
  orderId: z.string().nullable(),
  points: z.number().int(),
  label: z.string(),
  status: z.enum(['pending', 'done', 'failed', 'uncertain', 'resolved']),
  error: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClubMemberDto = z.infer<typeof clubMemberSchema>;
export type LoyaltySettingsDto = z.infer<typeof loyaltySettingsSchema>;
export type LoyaltySettingsResponse = z.infer<typeof loyaltySettingsResponseSchema>;
export type LoyaltyOperationDto = z.infer<typeof loyaltyOperationSchema>;
export type PointsAdjustRequest = z.infer<typeof pointsAdjustSchema>;

/** Codes promo (lot 11, ADR 0015) : création au back-office. Montants en centimes. */
export const promoInputSchema = z.object({
  code: z.string().trim().min(3).max(20),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  minSubtotalCents: z.number().int().nonnegative(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  maxUses: z.number().int().positive().nullable(),
});

export const adminPromoSchema = promoInputSchema.extend({
  id: z.uuid(),
  active: z.boolean(),
  uses: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const adminPromosSchema = z.object({ promos: z.array(adminPromoSchema) });

export type PromoInput = z.infer<typeof promoInputSchema>;
export type AdminPromoDto = z.infer<typeof adminPromoSchema>;
