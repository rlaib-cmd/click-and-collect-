import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1),
  /** Origines web autorisées (CORS), séparées par des virgules. `*` en développement. */
  CORS_ORIGINS: z.string().default('*'),
  /** Clé de dérivation des jetons de suivi de commande (32 caractères minimum, propre à chaque environnement). */
  ORDER_TOKEN_SECRET: z.string().min(32),
  /** Paiement : les trois clés ensemble, sinon le paiement en ligne est désactivé. */
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  /** Secret partagé avec la caisse Splash360 pour signer les retours de statut. */
  POS_WEBHOOK_SECRET: z.string().min(32).optional(),
  /** Fidélité de test (ADR 0009) : 'demo' active le programme de démonstration, 'off' le coupe. */
  LOYALTY: z.enum(['demo', 'off']).default('demo'),
  /** Connexion au club par simple e-mail, sans vérification : jamais en production. */
  LOYALTY_DEMO_LOGIN: z.enum(['0', '1']).default('0'),
  /** Back-office : vérification des sessions Supabase Auth (JWKS recommandé, secret HS256 en local). */
  SUPABASE_JWKS_URL: z.url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  SUPABASE_JWT_ISSUER: z.string().optional(),
  /** URL publique du back-office (retours Stripe). */
  ADMIN_URL: z.url().default('http://localhost:3000'),
  /** Derrière un proxy de confiance (hébergeur) : adresse client lue dans X-Forwarded-For. */
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
  /** Remontée des erreurs (facultatif). */
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  /** Jeton d'accès Expo (notifications push), facultatif. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  MENU_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  /** Âge maximal de la carte servie si l'API menu tombe ; au-delà, commande bloquée. Valeur à fixer avec Splash360. */
  /** Géocodeur (API Adresse, format GeoJSON) ; `demo` = adresses de démonstration hors ligne. */
  GEOCODER_URL: z.string().default('https://data.geopf.fr/geocodage/search'),
  MENU_MAX_STALE_MINUTES: z.coerce.number().int().nonnegative().default(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide ou manquante : ${fields}`);
  }
  return parsed.data;
}
