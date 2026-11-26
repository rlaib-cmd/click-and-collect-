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
  /**
   * Fidélité YouFID (lot 21, ADR 0026). `YOUFID_ACCOUNTS` : JSON indexé par sous-domaine
   * d'enseigne → { "login", "password" } (secret, jamais journalisé ; validé au démarrage).
   * Les enseignes absentes gardent la fidélité de `LOYALTY`. URL par défaut : celle de test.
   */
  YOUFID_ACCOUNTS: z.string().optional(),
  YOUFID_BASE_URL: z.url().startsWith('https://').optional(),
  /** Appareil stable (clé de session propre, 48 h) ; défaut « splash360-commande-<APP_ENV> ». */
  YOUFID_DEVICE_ID: z.string().min(1).max(100).optional(),
  /** Connexion au club par simple e-mail, sans vérification : jamais en production. */
  LOYALTY_DEMO_LOGIN: z.enum(['0', '1']).default('0'),
  /** Connexion du client par code SMS ou e-mail (lot 10, ADR 0012). */
  LOYALTY_OTP: z.enum(['0', '1']).default('0'),
  /**
   * Recette sans prestataire d'envoi : renvoie le code dans la réponse pour tester.
   * Sans effet en production (APP_ENV=production) ou dès qu'un prestataire est configuré.
   */
  OTP_DEBUG_ECHO: z.enum(['0', '1']).default('0'),
  /** Environnement : 'production' coupe toute aide de test. */
  APP_ENV: z.enum(['development', 'recette', 'production']).default('development'),
  /** Back-office : vérification des sessions Supabase Auth (JWKS recommandé, secret HS256 en local). */
  SUPABASE_JWKS_URL: z.url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  SUPABASE_JWT_ISSUER: z.string().optional(),
  /** Invitations du back-office par Supabase Auth : URL du projet et clé de service, ensemble. */
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /** URL publique du back-office (retours Stripe). */
  ADMIN_URL: z.url().default('http://localhost:3000'),
  /** App web des clients : retour après 3-D Secure (cartes enregistrées, lot 18). */
  CLIENT_APP_URL: z.url().startsWith('https://').optional(),
  /** Derrière un proxy de confiance (hébergeur) : adresse client lue dans X-Forwarded-For. */
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
  /** En-tête d'adresse client de l'hébergeur (Fly : fly-client-ip). */
  CLIENT_IP_HEADER: z.string().min(1).default('fly-client-ip'),
  /** Remontée des erreurs (facultatif). */
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  /** Jeton d'accès Expo (notifications push), facultatif. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** E-mails transactionnels Brevo ; sans clé, les e-mails sont seulement journalisés. */
  BREVO_API_KEY: z.string().min(10).optional(),
  /** Analyse de la photo « Ambassadeur » (lot 17) ; absente = vérification manuelle. */
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  AMBASSADOR_PHOTO_MODEL: z.string().min(3).optional(),
  EMAIL_SENDER: z.email().optional(),
  EMAIL_SENDER_NAME: z.string().default('Commande en ligne'),
  /**
   * API Click & Collect Splash360 (ADR 0018) : lues directement dans l'environnement par
   * `splash360CredentialsFrom` (SPLASH360_API_URL, SPLASH360_CLIENT_ID, SPLASH360_CLIENT_SECRET).
   * Sans identifiants : carte et caisse de démonstration.
   * Lot 19 (ADR 0024), facultatives : SPLASH360_TOKEN_URL (défaut api2), SPLASH360_SCOPE (`user`),
   * SPLASH360_MENU_PATH (`/api/export/v2/menus`), SPLASH360_ORDERS_API_URL (api2) et, pour l'export
   * des ventes avec d'autres identifiants, SPLASH360_ORDERS_CLIENT_ID / _SECRET (les deux ou aucun).
   */
  SPLASH360_API_URL: z.url().optional(),
  SPLASH360_CLIENT_ID: z.string().min(1).optional(),
  SPLASH360_CLIENT_SECRET: z.string().min(1).optional(),
  SPLASH360_TOKEN_URL: z.url().optional(),
  SPLASH360_SCOPE: z.string().min(1).optional(),
  SPLASH360_MENU_PATH: z
    .string()
    .regex(/^\/api\/export\//)
    .optional(),
  SPLASH360_ORDERS_API_URL: z.url().optional(),
  SPLASH360_ORDERS_CLIENT_ID: z.string().min(1).optional(),
  SPLASH360_ORDERS_CLIENT_SECRET: z.string().min(1).optional(),
  /** Identifiants propres à la carte, si Splash360 en fournit (les deux ou aucun). */
  SPLASH360_MENU_CLIENT_ID: z.string().min(1).optional(),
  SPLASH360_MENU_CLIENT_SECRET: z.string().min(1).optional(),
  SPLASH360_MENU_TOKEN_URL: z.url().optional(),
  SPLASH360_MENU_TOKEN_AUTH: z.enum(['basic', 'body']).optional(),
  /** Taux de TVA des frais envoyés à la caisse (à confirmer avec Splash360). */
  SPLASH360_FEE_VAT_RATE: z.coerce.number().min(0).max(1).default(0.2),
  /**
   * Webhooks Splash360 (lot 23, ADR 0029) : secrets de signature `whsec_…`, séparés par des
   * virgules (un par URL, plus l'ancien pendant un changement de secret). Absent : webhooks
   * refusés (503). Lus par `parseWebhookSecrets` au démarrage ; jamais journalisés.
   */
  SPLASH360_WEBHOOK_SECRETS: z.string().optional(),
  /** Attente maximale de la caisse avant paiement, puis après paiement. */
  POS_READY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  POS_CONFIRM_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
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
