import { z } from 'zod';

/**
 * Lot 22 (ADR 0027) : notifications « Bons plans à proximité ». Les règles de décision sont dans
 * `@splash360/core` (proximity.ts) ; ces schémas décrivent les échanges avec l'API.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure au format HH:MM');
const uuid = z.uuid();

export const proximityDeepLinkSchema = z.enum(['home', 'commander', 'avantages']);
export const proximityTargetSchema = z.enum(['all', 'reward', 'inactive']);

/** Règles de l'enseigne (back-office, PUT /v1/admin/proximity/settings). */
export const proximitySettingsSchema = z
  .object({
    enabled: z.boolean(),
    radiusMeters: z.number().int().min(100).max(1000),
    title: z.string().trim().min(1).max(65),
    body: z.string().trim().min(1).max(178),
    deepLink: proximityDeepLinkSchema,
    onlyOpeningHours: z.boolean(),
    quietHours: z.object({ start: hhmm, end: hhmm }).nullable(),
    memberCapHours: z.number().int().min(1).max(720),
    restaurantCapHours: z.number().int().min(1).max(2160),
    target: proximityTargetSchema,
    inactiveDays: z.number().int().min(1).max(365),
  })
  .refine((r) => !r.quietHours || r.quietHours.start !== r.quietHours.end, {
    message: 'Heures calmes : début et fin différents',
    path: ['quietHours'],
  });

/** Statistiques du back-office : envois, ouvertures et commandes dans les 2 h. */
export const proximityStatsSchema = z.object({
  last7Days: z.object({
    sent: z.number().int(),
    opened: z.number().int(),
    orders: z.number().int(),
  }),
  last30Days: z.object({
    sent: z.number().int(),
    opened: z.number().int(),
    orders: z.number().int(),
  }),
  /** Membres ayant activé la fonction sur au moins un appareil. */
  optedInMembers: z.number().int(),
});

/** GET /v1/admin/proximity */
export const adminProximitySchema = z.object({
  settings: proximitySettingsSchema,
  stats: proximityStatsSchema,
});

/** GET /v1/tenants/:subdomain/proximity (membre connecté) : zones à surveiller. */
export const proximityRegionsSchema = z.object({
  /** false : fonction désactivée par l'enseigne ; l'application arrête la surveillance. */
  enabled: z.boolean(),
  radiusMeters: z.number().int().min(100).max(1000),
  restaurants: z.array(
    z.object({
      restaurantId: uuid,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  ),
});

/** PUT /v1/tenants/:subdomain/proximity/device : consentement donné sur cet appareil. */
export const proximityDeviceSchema = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(['ios', 'android']),
});

/** POST /v1/tenants/:subdomain/proximity/opt-out : sans jeton, tous les appareils du membre. */
export const proximityOptOutSchema = z.object({
  token: z
    .string()
    .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/)
    .nullable(),
});

/** POST /v1/tenants/:subdomain/proximity/enter : entrée dans la zone d'un restaurant. */
export const proximityEnterSchema = z.object({ restaurantId: uuid });
export const proximityEnterResponseSchema = z.object({ notified: z.boolean() });

/** POST /v1/tenants/:subdomain/proximity/opened : notification ouverte (statistiques). */
export const proximityOpenedSchema = z.object({ eventId: uuid });

/** Données jointes à la notification, relues par l'application à l'ouverture. */
export const proximityPushDataSchema = z.object({
  kind: z.literal('proximity'),
  eventId: uuid,
  link: proximityDeepLinkSchema,
});

export type ProximitySettingsDto = z.infer<typeof proximitySettingsSchema>;
export type ProximityStatsDto = z.infer<typeof proximityStatsSchema>;
export type AdminProximityDto = z.infer<typeof adminProximitySchema>;
export type ProximityRegionsDto = z.infer<typeof proximityRegionsSchema>;
export type ProximityDeviceRequest = z.infer<typeof proximityDeviceSchema>;
export type ProximityEnterResponse = z.infer<typeof proximityEnterResponseSchema>;
export type ProximityPushData = z.infer<typeof proximityPushDataSchema>;
