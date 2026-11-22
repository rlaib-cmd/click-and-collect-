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
| `POS_WEBHOOK_SECRET` | pour la caisse | Secret partagé avec Splash360 (retour des statuts) |
| `GEOCODER_URL` | non | Géocodeur au format API Adresse (Géoplateforme par défaut) |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | recommandé | Remontée des erreurs |
| `EXPO_ACCESS_TOKEN` | non | Notifications push (sécurité renforcée Expo) |
| `ADMIN_URL` | oui | URL du back-office (retours d'inscription Stripe) |

### Back-office (`apps/admin`)

`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Ne **jamais** définir `ADMIN_DEV_LOGIN` hors développement (la route est de toute façon désactivée en production).

### Application (`apps/mobile`)

`EXPO_PUBLIC_API_URL`, et pour un build d'enseigne `BRAND` + `EXPO_PUBLIC_TENANT` (fixés par les profils `eas.json`).

## Base de données

1. Créer le projet Supabase (région UE), activer PITR en production.
2. `supabase link --project-ref <ref>` puis `supabase db push` (migrations versionnées de `supabase/migrations/`). Jamais `seed.sql` en production.
3. Créer le premier super-administrateur : `insert into staff_users (email, role) values ('...', 'super_admin');` puis l'inviter dans Supabase Auth.

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
