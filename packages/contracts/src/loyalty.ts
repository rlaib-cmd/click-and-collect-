import { z } from 'zod';

export const loyaltyRewardSchema = z.object({
  id: z.string(),
  name: z.string(),
  costPoints: z.number().int().positive(),
  /** Produit de la carte offert par la récompense. */
  productId: z.string(),
});

/** Réponse de GET /v1/tenants/{subdomain}/loyalty/program. */
export const loyaltyProgramSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    name: z.string(),
    pointsPerEuro: z.number().int().nonnegative(),
    welcomePoints: z.number().int().nonnegative(),
    rewards: z.array(loyaltyRewardSchema),
    /** Données de test : connexion par e-mail sans vérification (ADR 0009). */
    demo: z.boolean(),
  }),
]);

export const loyaltyJoinRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{10,20}$/, 'Numéro de téléphone invalide')
    .nullable(),
  acceptedTerms: z.literal(true),
});

export const loyaltyLoginRequestSchema = z.object({ email: z.email().max(200) });

export const loyaltyMovementSchema = z.object({
  kind: z.enum(['welcome', 'earn', 'redeem']),
  points: z.number().int(),
  label: z.string(),
  at: z.iso.datetime(),
});

/** Réponse de GET /loyalty/me (en-tête Authorization: Bearer <jeton de membre>). */
export const loyaltyMemberSchema = z.object({
  name: z.string(),
  email: z.string(),
  points: z.number().int().nonnegative(),
  /** Contenu du QR code à présenter en caisse. */
  cardCode: z.string(),
  /** Prochaine récompense pas encore atteinte ; null si toutes le sont. */
  nextReward: z
    .object({ name: z.string(), costPoints: z.number().int(), missingPoints: z.number().int() })
    .nullable(),
  history: z.array(loyaltyMovementSchema),
});

/** Réponse de l'adhésion et de la connexion. */
export const loyaltySessionSchema = z.object({
  /** Jeton secret du membre, conservé par l'application. */
  memberToken: z.string().min(20),
  member: loyaltyMemberSchema,
});

export type LoyaltyProgramDto = z.infer<typeof loyaltyProgramSchema>;
export type LoyaltyRewardDto = z.infer<typeof loyaltyRewardSchema>;
export type LoyaltyMemberDto = z.infer<typeof loyaltyMemberSchema>;
export type LoyaltySession = z.infer<typeof loyaltySessionSchema>;
export type LoyaltyJoinRequest = z.infer<typeof loyaltyJoinRequestSchema>;
