# CLAUDE.md — Splash360 Commande

Application de commande en ligne en marque blanche (Click & Collect et livraison) pour les enseignes clientes de Splash360.
La référence du projet est `docs/cahier-des-charges.md` : la relire avant chaque lot.

## Règles non négociables

- Les prix et les frais sont calculés côté serveur avec `packages/core`, jamais reçus de l'application. L'application n'envoie que des identifiants de produits et d'options, et des quantités.
- Une commande ne passe à « payée » que sur webhook Stripe vérifié (signature contrôlée, traitement idempotent).
- Aucune donnée de carte et aucune clé secrète dans l'application (mobile, web ou back-office côté navigateur). Seules les clés publiables Stripe et Supabase y sont admises.
- Toute table porte l'identifiant de l'enseigne (`tenant_id`), avec des règles d'accès (RLS) testées.
- La carte vient uniquement de l'API menu Splash360, via `packages/api-menu`. Aucun autre paquet n'appelle cette API.
- TypeScript strict, pas de `any`. Chaque règle métier a ses tests.
- Un seul lot à la fois (section 9 du cahier des charges). Ne pas commencer le lot suivant sans l'accord explicite de l'utilisateur.
- Ne rien inventer : ce qui est ambigu ou manquant (notamment l'API Splash360) est signalé avant de coder.

## Structure du dépôt (cible du lot 0)

```
apps/
  mobile/        Application client Expo (iOS, Android, web) — Expo Router
  admin/         Back-office Next.js (App Router)
  api/           Serveur de la commande en ligne : création de commande, paiement, webhooks Stripe, envoi à la caisse
packages/
  core/          Règles métier pures (prix, frais, minimum, créneaux, options) — aucune dépendance réseau
  api-menu/      Seul client de l'API menu Splash360 ; traduit vers les types internes
  db/            Types générés depuis la base, client Supabase serveur
  theme/         Thème de l'enseigne, contraste automatique
  i18n/          Textes externalisés (fr)
  config/        tsconfig, ESLint, Prettier partagés
supabase/
  migrations/    Migrations SQL versionnées
  tests/         Tests des règles d'accès (RLS)
docs/            Cahier des charges, plans de lot, doc de l'API Splash360 (docs/api-splash360/)
```

## Commandes

Depuis la racine (Node 22, pnpm 10) :

- `pnpm install` — installe tout le monorepo
- `pnpm dev` — lance les trois applications (Turborepo)
- `pnpm --filter mobile start` — application client (Expo) ; `pnpm --filter mobile web` pour la version web
- `pnpm --filter admin dev` — back-office sur http://localhost:3000
- `pnpm --filter api dev` — serveur sur http://localhost:8787 (`GET /health`)
- `pnpm test` — tests unitaires et d'intégration (Vitest)
- `pnpm typecheck` — contrôle de types de tous les paquets
- `pnpm lint` — ESLint ; `pnpm format` / `pnpm format:check` — Prettier
- `pnpm db:start` / `pnpm db:reset` — base Supabase locale (Docker requis) et migrations
- `pnpm db:test` — tests pgTAP des règles d'accès (`supabase/tests/`)

Avant de déclarer une étape terminée : `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.
La CI (`.github/workflows/ci.yml`) lance en plus le build du back-office, l'export web Expo et les tests de la base.

## Conventions

- Monorepo pnpm + Turborepo. Les paquets internes sont nommés `@splash360/<nom>` et publiés en TypeScript source (pas d'étape de build) ; le back-office les déclare dans `transpilePackages`.
- TypeScript 6.0, aligné sur le SDK Expo 58 (TypeScript 7 n'est pas encore supporté par typescript-eslint).
- Toute nouvelle table : colonne `tenant_id`, RLS activée, test dans `supabase/tests/` (le test générique échoue sinon).
- Installer les dépendances natives de l'application mobile avec `npx expo install <paquet>` (jamais `pnpm add` direct), en particulier `@stripe/stripe-react-native`, dont la version dépend du SDK Expo.
- Stripe sur mobile exige la nouvelle architecture React Native et, sur iOS, des frameworks dynamiques (`expo-build-properties` → `useFrameworks: "dynamic"`). Apple Pay et Google Pay ne fonctionnent pas dans Expo Go : utiliser un build de développement EAS.
- Montants en centimes (entiers), devise EUR ; jamais de nombres à virgule pour l'argent.
- Libellés et prix copiés (« figés ») dans `order_items` et `order_item_options` au moment de la commande.
- Textes visibles par l'utilisateur dans `packages/i18n`, jamais en dur dans les écrans.
- Lire la documentation à jour (Expo, EAS, Stripe, Supabase) avant d'utiliser une API : ne pas se fier à la mémoire pour les versions ni les noms.
- Petits commits, un par étape, messages en français à l'impératif.

## Environnements

Développement, recette, production : chacun a sa base, ses clés Stripe (mode test hors production) et son accès à l'API Splash360. Les secrets restent dans les variables d'environnement du serveur ; les fichiers `.env*` ne sont jamais commités (seul `.env.example` l'est).
