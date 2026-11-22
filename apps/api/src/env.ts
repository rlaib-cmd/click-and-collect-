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
