import { z } from 'zod';

export const loyaltyRewardSchema = z.object({
  id: z.string(),
  name: z.string(),
  costPoints: z.number().int().positive(),
  /** Palier (lot 11) : produits de la carte au choix, au moins un. */
  productIds: z.array(z.string()).min(1),
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
    /** Connexion par code reçu par SMS ou e-mail (lot 10, ADR 0012). */
    otp: z.boolean(),
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

export const otpChannelSchema = z.enum(['sms', 'email']);

/** POST /loyalty/otp/start : envoie un code au mobile (SMS) ou à l'adresse e-mail. */
export const otpStartRequestSchema = z.object({
  channel: otpChannelSchema,
  /** Numéro de mobile français (06…, +33…) ou adresse e-mail selon le canal. */
  identifier: z.string().trim().min(3).max(200),
});

/** Même réponse qu'un compte existe ou non. */
export const otpStartResponseSchema = z.object({
  sent: z.literal(true),
  /** Identifiant normalisé (+33…, e-mail en minuscules), à renvoyer avec le code. */
  identifier: z.string(),
  /** Délai avant de pouvoir redemander un code. */
  resendInSeconds: z.number().int().nonnegative(),
  /** Recette sans prestataire d'envoi uniquement : le code, pour tester. Jamais en production. */
  debugCode: z.string().optional(),
});

/** POST /loyalty/otp/verify : code reçu ; prénom et CGU lors d'une création de compte. */
export const otpVerifyRequestSchema = z.object({
  channel: otpChannelSchema,
  identifier: z.string().trim().min(3).max(200),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Code à 6 chiffres'),
  name: z.string().trim().min(2).max(100).optional(),
  acceptedTerms: z.literal(true).optional(),
});

export const loyaltyMovementSchema = z.object({
  kind: z.enum(['welcome', 'earn', 'redeem', 'adjust']),
  points: z.number().int(),
  label: z.string(),
  at: z.iso.datetime(),
});

/** Réponse de GET /loyalty/me (en-tête Authorization: Bearer <jeton de membre>). */
export const loyaltyMemberSchema = z.object({
  name: z.string(),
  /** null : compte créé avec le seul téléphone. */
  email: z.string().nullable(),
  /** Mobile au format international (+33…). */
  phone: z.string().nullable(),
  points: z.number().int().nonnegative(),
  /** Points réservés par les cadeaux des commandes en cours, pas encore débités (ADR 0013). */
  reservedPoints: z.number().int().nonnegative().default(0),
  /** Contenu du QR code à présenter en caisse. */
  cardCode: z.string(),
  /** Prochaine récompense pas encore atteinte avec les points disponibles ; null si toutes le sont. */
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

/** Réponse de la vérification : session ouverte, ou prénom demandé pour créer le compte. */
export const otpVerifyResponseSchema = z.union([
  loyaltySessionSchema,
  z.object({ needsName: z.literal(true) }),
]);

export type LoyaltyProgramDto = z.infer<typeof loyaltyProgramSchema>;
export type LoyaltyRewardDto = z.infer<typeof loyaltyRewardSchema>;
export type LoyaltyMemberDto = z.infer<typeof loyaltyMemberSchema>;
export type LoyaltySession = z.infer<typeof loyaltySessionSchema>;
export type LoyaltyJoinRequest = z.infer<typeof loyaltyJoinRequestSchema>;
export type OtpChannel = z.infer<typeof otpChannelSchema>;
export type OtpStartRequest = z.infer<typeof otpStartRequestSchema>;
export type OtpStartResponse = z.infer<typeof otpStartResponseSchema>;
export type OtpVerifyRequest = z.infer<typeof otpVerifyRequestSchema>;
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;
