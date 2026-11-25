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
| `STRIPE_PAYMENT_DOMAINS` | pour Apple Pay / Google Pay web | Domaines de l'app web (séparés par des virgules, sans https), déclarés chez Stripe pour chaque restaurant à son inscription |
| `SUPABASE_JWKS_URL` | pour le back-office | `https://<projet>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | pour inviter | Invitations des comptes du back-office (lien « Choisir mon mot de passe ») ; clé de service côté serveur uniquement |
| `SPLASH360_CLIENT_ID`, `SPLASH360_CLIENT_SECRET` | pour la vraie caisse | Accès OAuth2 à l'API Click & Collect Splash360 (ADR 0018) ; sans eux, carte et caisse de démonstration. À poser en secret du serveur uniquement |
| `SPLASH360_API_URL` | non | `https://api.splash360.fr` par défaut |
| `SPLASH360_FEE_VAT_RATE` | non | Taux de TVA des frais transmis à la caisse (0,2 par défaut, à confirmer avec Splash360) |
| `POS_READY_TIMEOUT_SECONDS`, `POS_CONFIRM_TIMEOUT_SECONDS` | non | Attente de la caisse avant paiement (60 s) et de sa confirmation après paiement (300 s, puis remboursement automatique) |
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

## Relance périodique de la caisse Splash360 (lot 14)

Le suivi des commandes en caisse (attente de « ready », puis de « verified ») avance à chaque requête reçue
par l'API, au plus toutes les 10 s. Sans trafic (la nuit, commande sur place que personne ne suit), il faut
une relance planifiée, à poser une fois par environnement (SQL Editor de Supabase) :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('relance-caisse-splash360', '10 seconds',
  $$select net.http_get('https://<projet>.supabase.co/functions/v1/api/health')$$);
```

Pour l'arrêter : `select cron.unschedule('relance-caisse-splash360');`

Installée en recette le 25/11. Coût : 8 640 appels de la fonction par jour (environ 260 000 par
mois, sur 2 millions inclus dans l'offre Pro). L'historique de pg_cron garde une ligne par passage :
à purger chaque nuit (installé en recette le 25/11, à 3h17 UTC) :

```sql
select cron.schedule('nettoyage-historique-cron', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '2 days'$$);
```

## Projet Supabase de production

`splash360-commande-production`, référence `azenkeuuejwwtbudvwqt`, région Paris (eu-west-3), créé
le 25/11. URL de l'API : `https://azenkeuuejwwtbudvwqt.supabase.co/functions/v1/api`.

### Installé et vérifié le 25/11

- Les 23 migrations de `supabase/migrations/`, versions alignées sur les fichiers
  (`supabase_migrations.schema_migrations`). **Aucune donnée** : ni `seed.sql`, ni enseigne,
  ni compte de test. 25 tables, RLS active sur toutes (accès serveur uniquement, ADR 0002).
- Contrôles Supabase : seulement des signalements « INFO » attendus (tables sans règle d'accès :
  voulu ; index inutilisés : base vide).
- Fonction Edge `api` (même code que la recette), `verify_jwt` désactivé (authentification faite
  par l'API). `GET /health` → 200 ; une enseigne inconnue → 404 propre.
- Secrets posés : `APP_ENV=production`, `DATABASE_POOLER_HOST` (connexion par le pooler,
  vérifiée : connexions « Supavisor » uniquement). Les autres (`SUPABASE_*`) sont fournis par
  Supabase.
- pg_cron : relance de caisse toutes les 10 s (`/health`) et purge nocturne de son historique
  (3h17 UTC). Premiers passages réussis.

### Reste à faire, et qui le fournit

| Élément | Qui | Variables / action |
|---|---|---|
| Compte super-administrateur | L'utilisateur (accord direct requis) | Compte Supabase Auth à l'adresse du propriétaire + ligne `staff_users` rôle `super_admin` (rattachée au compte par l'e-mail à la première connexion, comme `resolveStaff`). Le propriétaire choisit son mot de passe par le lien « mot de passe oublié » du back-office de production (Supabase Auth, e-mail de réinitialisation) une fois l'URL du site et l'envoi d'e-mails réglés. |
| Paiement en ligne | L'utilisateur (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (clés **live**), webhook Connect live → `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_DOMAINS`. Sans elles, seul le paiement sur place fonctionne. |
| Caisse Splash360 | Splash360 (Abdoul) | Accès par restaurant (`SPLASH360_CLIENT_ID`, `SPLASH360_CLIENT_SECRET`, `SPLASH360_API_URL` si différent). |
| SMS et e-mails | L'utilisateur (Brevo) | `BREVO_API_KEY`, `EMAIL_SENDER`, `EMAIL_SENDER_NAME`, puis `LOYALTY_OTP=1` pour la connexion par code. Jamais `OTP_DEBUG_ECHO` en production. |
| Back-office et app de production | Équipe projet | Domaines, puis builds pointés vers l'API de production ; `ADMIN_URL` (liens d'invitation et retours Stripe). Jamais `NEXT_PUBLIC_SHOW_TEST_ACCOUNTS` en production. |
| Supabase Auth | L'utilisateur (tableau de bord) | URL du site et URL de redirection = back-office de production ; protection contre les mots de passe compromis ; SMTP personnalisé (Brevo) pour les e-mails d'invitation et de réinitialisation. |

## Connexion à la base par le pooler (25/11)

Le serveur se connecte par le pooler Supabase (Supavisor, mode transaction, port 6543) dès que
`DATABASE_POOLER_HOST` est posé (valeur non secrète, ex. `aws-0-eu-west-3.pooler.supabase.com`,
lue dans Supabase → Connect → Transaction pooler). L'adresse est construite avec le mot de passe de
`SUPABASE_DB_URL`, fourni et tenu à jour par Supabase : aucun mot de passe à recopier, y compris
après une réinitialisation. Le journal « Connexion base » indique au démarrage le mode utilisé.
`DATABASE_POOLER_URL` (adresse complète saisie à la main) reste accepté si l'hôte n'est pas posé.
Vérification : `pg_stat_activity` ne montre que quelques connexions « Supavisor ».
