import { z } from 'zod';

/**
 * Ambassadeur (lot 15, ADR 0019) : le client partage son burger en story Instagram en taguant
 * l'enseigne ; bonus de points une fois la mention confirmée, une fois par ticket.
 */

/** Compte Instagram : saisi avec ou sans « @ », toujours enregistré sans. */
export const instagramHandleSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ''))
  .pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9._]{1,30}$/, 'Compte Instagram invalide (lettres, chiffres, point, _)'),
  );

/** Numéro du ticket de caisse : majuscules, sans espaces. */
export const ticketRefSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9-]{3,40}$/, 'Numéro de ticket invalide'));

/** Réponse publique de GET /v1/tenants/{subdomain}/ambassador. */
export const ambassadorConfigSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(true),
    /** Compte à taguer, sans « @ » (le bouton « Copier » copie cette valeur telle quelle). */
    instagramHandle: z.string(),
    bonusPoints: z.number().int().positive(),
  }),
  z.object({ enabled: z.literal(false) }),
]);
export type AmbassadorConfig = z.infer<typeof ambassadorConfigSchema>;

/** POST /v1/tenants/{subdomain}/ambassador/entries (membre connecté). */
export const ambassadorEntryRequestSchema = z.object({
  ticketRef: ticketRefSchema,
  instagramHandle: instagramHandleSchema,
});
export type AmbassadorEntryRequest = z.input<typeof ambassadorEntryRequestSchema>;

export const ambassadorStatusSchema = z.enum(['pending', 'confirmed', 'rejected']);

export const ambassadorEntrySchema = z.object({
  id: z.string(),
  status: ambassadorStatusSchema,
  ticketRef: z.string(),
  bonusPoints: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type AmbassadorEntryDto = z.infer<typeof ambassadorEntrySchema>;

export const ambassadorEntriesSchema = z.object({ entries: z.array(ambassadorEntrySchema) });

/** Back-office : réglages de l'enseigne. */
export const ambassadorSettingsSchema = z
  .object({
    enabled: z.boolean(),
    instagramHandle: instagramHandleSchema.nullable(),
    bonusPoints: z.number().int().min(1).max(10000),
  })
  .refine((s) => !s.enabled || s.instagramHandle !== null, {
    message: 'Indiquez le compte Instagram à taguer',
    path: ['instagramHandle'],
  });
export type AmbassadorSettingsDto = z.infer<typeof ambassadorSettingsSchema>;

/** Back-office : participations reçues. */
export const adminAmbassadorEntriesSchema = z.object({
  entries: z.array(
    ambassadorEntrySchema.extend({
      memberId: z.string(),
      instagramHandle: z.string(),
      decidedAt: z.iso.datetime().nullable(),
    }),
  ),
});
