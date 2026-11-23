# Mise en production

Guide d'exploitation de Splash360 Commande. À tenir à jour à chaque changement d'infrastructure.

## Vue d'ensemble

| Composant | Contenu | Hébergement recommandé |
|---|---|---|
| `apps/api` | API Node (Hono) : commandes, paiement, webhooks, caisse, back-office | Conteneur en région UE (Scaleway Serverless Containers, Fly.io `cdg`, Clever Cloud) — image `apps/api/Dockerfile` |
| Base | Postgres Supabase (région UE), sauvegardes et restauration à un instant (PITR) | Supabase, projet par environnement |
| `apps/admin` | Back-office Next.js | Vercel (région `cdg1`) ou conteneur |
| `apps/mobile` (web) | Export statique Expo, une seule build pour toutes les enseignes | Hébergement statique avec domaine joker `*.<domaine>` (Cloudflare Pages, Netlify) |
| `apps/mobile` (iOS/Android) | Une application par enseigne (ADR 0004) | EAS Build / Submit / Update |

## Environnements

Trois environnements : développement, recette, production. Chacun a sa base Supabase, ses clés Stripe (mode test hors production), son secret de jetons et son accès à l'API Splash360. Aucune donnée de production en recette.

### Variables de l'API (`apps/api/.env.example`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | Postgres (rôle serveur, pooler Supabase en mode transaction) |
| `ORDER_TOKEN_SECRET` | oui | Dérivation des jetons de suivi (`openssl rand -base64 48`) ; le changer invalide les liens de suivi en cours |
| `CORS_ORIGINS` | oui en prod | Origines web autorisées (`https://*.domaine` n'est pas accepté : lister ou passer par un proxy) |
| `TRUST_PROXY` | selon hébergeur | `1` derrière le proxy de l'hébergeur (limitation de débit par IP réelle) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | pour encaisser | Compte plateforme Stripe Connect ; webhook Connect sur `/v1/webhooks/stripe` |
| `SUPABASE_JWKS_URL` | pour le back-office | `https://<projet>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | pour inviter | Invitations des comptes du back-office (lien « Choisir mon mot de passe ») ; clé de service côté serveur uniquement |
| `POS_WEBHOOK_SECRET` | pour la caisse | Secret partagé avec Splash360 (retour des statuts) |
| `GEOCODER_URL` | non | Géocodeur au format API Adresse (Géoplateforme par défaut) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | recommandé | Remontée des erreurs |
| `EXPO_ACCESS_TOKEN` | non | Notifications push (sécurité renforcée Expo) |
| `ADMIN_URL` | oui | URL du back-office (retours d'inscription Stripe) |
| `LOYALTY_OTP` | oui | `1` : connexion du client par code SMS ou e-mail (ADR 0012) |
| `APP_ENV` | oui en prod | `production` : aucune aide de test (code renvoyé, connexion par e-mail sans code) |
| `OTP_DEBUG_ECHO` | recette seulement | `1` : code de connexion renvoyé à l'écran tant qu'aucun prestataire n'envoie |

### Back-office (`apps/admin`)

`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLIENT_APP_URL` (adresse web de l'application client, pour le lien d'aperçu du studio design, lot 12). Ne **jamais** définir `ADMIN_DEV_LOGIN` hors développement (la route est de toute façon désactivée en production), ni `NEXT_PUBLIC_SHOW_TEST_ACCOUNTS` (panneau « Comptes de test » de la page de connexion, recette uniquement, lot 13).

### Application (`apps/mobile`)

`EXPO_PUBLIC_API_URL`, et pour un build d'enseigne `BRAND` + `EXPO_PUBLIC_TENANT` (fixés par les profils `eas.json`).

## Production retenue : Fly.io + Supabase + Brevo

1. **Supabase** : projet `splash360-commande-prod` (région Paris `eu-west-3`, organisation Splash 360).
2. **Fly.io** : `flyctl launch --no-deploy --copy-config` (application `splash360-commande-api`, région `cdg`, fichier `fly.toml`),
   puis `fly secrets set DATABASE_URL=… ORDER_TOKEN_SECRET=… SUPABASE_JWKS_URL=… ADMIN_URL=… CORS_ORIGINS=…`
   (et plus tard `STRIPE_*`, `POS_WEBHOOK_SECRET`, `BREVO_API_KEY`, `EMAIL_SENDER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
3. **GitHub** (Settings → Environments → `production`) : secrets `FLY_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`. Déploiement : onglet Actions → « Déploiement production » → Run
   (migrations puis API, vérification `/ready`).
4. **Brevo** : domaine d'envoi authentifié (SPF, DKIM), adresse d'expédition vérifiée, clé API transactionnelle
   (`BREVO_API_KEY`, `EMAIL_SENDER`, `EMAIL_SENDER_NAME`). Sans clé, les e-mails sont seulement journalisés.
   **SMS de connexion** (ADR 0012) : activer les SMS transactionnels sur le compte Brevo et acheter des
   crédits (la même clé API sert) ; l'expéditeur affiché est le nom de l'enseigne (11 caractères).
   Prévoir une alerte de crédit bas dans Brevo : sans crédit, plus aucun client ne peut se connecter par SMS
   (le code par e-mail reste possible).
5. **Invitations du back-office** (Supabase → Authentication) : l'expéditeur intégré de Supabase est
   limité à quelques e-mails par heure ; brancher **Brevo en SMTP personnalisé** (Authentication → Emails →
   SMTP Settings : `smtp-relay.brevo.com`, port 587, identifiant et clé SMTP Brevo, expéditeur vérifié).
   Dans URL Configuration, ajouter l'URL `https://<back-office>/mot-de-passe/` aux redirections autorisées
   et traduire les modèles « Invite user » et « Reset password » en français.
6. **Application** : profil `<enseigne>-production` (API `https://splash360-commande-api.fly.dev`), Google Play :
   [`stores/google-play.md`](stores/google-play.md).

## Base de données

1. Créer le projet Supabase (région UE), activer PITR en production.
2. `supabase link --project-ref <ref>` puis `supabase db push` (migrations versionnées de `supabase/migrations/`). Jamais `seed.sql` en production.
3. Créer le premier super-administrateur : `insert into staff_users (email, role) values ('...', 'super_admin');` puis l'inviter dans Supabase Auth (Authentication → Users → Invite). Les administrateurs d'enseigne sont ensuite invités automatiquement depuis le back-office.

## Stripe

1. Compte plateforme, Connect activé, profil de plateforme complété.
2. Webhook **Connect** → `https://api.<domaine>/v1/webhooks/stripe` : `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`.
3. Apple Pay web : vérifier le domaine `*.<domaine>` chez Stripe ; Apple Pay iOS : identifiant marchand par enseigne (`brands/<enseigne>.json`).
4. Chaque restaurant s'inscrit depuis le back-office (page Paiement).

## Applications mobiles

1. `eas init` (une fois) pour lier le projet Expo ; renseigner le `projectId` (notifications push).
2. Par enseigne : `brands/<enseigne>.json`, profils `<enseigne>-preview` et `<enseigne>-production` dans `eas.json`.
3. `eas build --profile <enseigne>-production --platform all` puis `eas submit`.
4. Correctifs JavaScript sans passer par les stores : `eas update --channel production`.

## Web

`EXPO_PUBLIC_API_URL=https://api.<domaine> pnpm --filter mobile exec expo export --platform web`, puis publier `apps/mobile/dist` sur l'hébergement statique avec le domaine joker. L'enseigne est lue dans le sous-domaine.

## Exploitation

- **Sondes** : `/health` (processus vivant), `/ready` (base joignable) — utilisée par le `HEALTHCHECK` de l'image.
- **Journaux** : JSON sur une ligne, `requestId` sur chaque requête (en-tête `X-Request-Id` renvoyé au client), sans données personnelles ni paramètres de requête.
- **Alertes à brancher** : erreurs Sentry ; taux de réponses 5xx ; webhooks Stripe en échec (tableau de bord Stripe) ; envois à la caisse abandonnés (affichés au back-office, à remonter aussi en alerte).
- **Tâches de fond** (dans l'API) : expiration des commandes non payées (toutes les minutes), envois à la caisse (toutes les 15 s). Sûres avec plusieurs instances.
- **Limitation de débit** : par instance ; au-delà de 2–3 instances, passer à un stockage partagé (Redis).

## Mise en production d'une version

1. CI verte sur la branche principale (lint, types, tests, base, builds, image Docker).
2. `supabase db push` sur la recette, puis déploiement de l'API et du back-office en recette ; parcours complet en mode test Stripe.
3. Même séquence en production : migrations d'abord (toujours rétrocompatibles), puis API, puis back-office et web, puis `eas update`.

## Studio design (lot 12)

- Logos téléversés : bucket public `brand-assets` de Supabase Storage, créé par la migration
  `20261123050000_theme_draft.sql` (2 Mo, PNG/JPEG/WebP). L'API écrit avec `SUPABASE_URL` et
  `SUPABASE_SERVICE_ROLE_KEY` (serveur seulement) ; sans eux, le téléversement répond 503 et seul le
  champ « adresse du logo » sert.
- Le design publié arrive dans les applications au prochain chargement (configuration publique en
  cache 60 secondes). Icône, nom et écran de démarrage : nouvelle version sur les stores.
