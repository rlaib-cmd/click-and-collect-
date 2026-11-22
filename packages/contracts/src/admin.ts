import { z } from 'zod';
import { menuSchema } from './menu';
import { orderStatusSchema, totalsSchema } from './ordering';
import { subdomainSchema, tenantThemeSchema } from './tenant';

const cents = z.number().int().nonnegative();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const staffRoleSchema = z.enum(['super_admin', 'tenant_admin', 'staff']);

export const meSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  role: staffRoleSchema,
  /** Enseigne courante (choisie par le super-administrateur, imposée sinon). */
  tenant: z.object({ id: z.uuid(), name: z.string(), subdomain: z.string() }).nullable(),
  restaurantId: z.uuid().nullable(),
});

export const adminRestaurantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  city: z.string(),
  status: z.enum(['active', 'paused', 'closed']),
  stripeAccountId: z.string().nullable(),
  stripeChargesEnabled: z.boolean(),
});

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
  customer: z.object({ name: z.string(), email: z.string(), phone: z.string() }),
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
    }),
  ),
  history: z.array(z.object({ status: z.string(), actor: z.string(), at: z.iso.datetime() })),
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

export const legalSchema = z.object({ text: z.string().max(50_000).nullable() });

export const menuOverrideSchema = z.object({
  kind: z.enum(['category', 'product']),
  itemId: z.string().min(1).max(100),
  hidden: z.boolean(),
  position: z.number().int().min(0).max(10_000).nullable(),
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
  email: z.string(),
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
});

export const inviteSchema = z
  .object({
    email: z.email().max(200),
    name: z.string().max(100).nullable(),
    role: z.enum(['tenant_admin', 'staff']),
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
  email: z.string(),
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

export type Me = z.infer<typeof meSchema>;
export type AdminRestaurant = z.infer<typeof adminRestaurantSchema>;
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export type SettingsDto = z.infer<typeof settingsSchema>;
export type AdminMenu = z.infer<typeof adminMenuSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type CustomerRowDto = z.infer<typeof customerRowSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type TenantSummaryDto = z.infer<typeof tenantSummarySchema>;
export type AlertDto = z.infer<typeof alertSchema>;
export type ClubMemberDto = z.infer<typeof clubMemberSchema>;
export type PointsAdjustRequest = z.infer<typeof pointsAdjustSchema>;
