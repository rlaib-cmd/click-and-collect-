# Plan — Lot 0 : Socle

**Critère d'acceptation (section 9)** : les trois applications démarrent ; les tests et le contrôle de types passent.

Statut : **proposé, en attente de validation.**

## Versions relevées le 2026-11-22 (registre npm)

| Outil | Version |
|---|---|
| Expo SDK | 58 (`expo` 58.0.26, `expo-router` 58.0.x) |
| React Native | celle imposée par le SDK 58 (`npx expo install`) |
| `@stripe/stripe-react-native` | 0.85.x (version exacte fixée par `npx expo install`) |
| Next.js | 16.4.x |
| `stripe` (Node) | 23.x |
| `@supabase/supabase-js` / CLI `supabase` | 2.119.x / 3.2.x |
| Turborepo | 2.11.x |
| pnpm | 10.x (version de l'environnement ; 12.x disponible) |
| Vitest | 5.x |
| Node | 22 LTS |

Point d'attention : TypeScript 7 (réécriture native) est sorti. On fixe la version de TypeScript sur celle que supportent officiellement Expo 58 et Next 16, et non sur la dernière.

Remarque : docs.expo.dev et docs.stripe.com ne sont pas joignables depuis cette session. Les faits Stripe ci-dessous viennent du README de `@stripe/stripe-react-native` ; la doc Stripe Connect sera relue avant le lot 4.

## Étapes (un commit par étape)

1. **Racine du monorepo** : `package.json`, `pnpm-workspace.yaml`, `turbo.json` (tâches `dev`, `build`, `test`, `typecheck`, `lint`), `.gitignore`, `.nvmrc`, `.env.example`.
2. **`packages/config`** : tsconfig de base en mode strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint (règle `no-explicit-any` en erreur), Prettier.
3. **`packages/core`** : paquet vide mais câblé (Vitest, typecheck), avec un premier test (montants en centimes) pour prouver la chaîne.
4. **`packages/api-menu`, `packages/db`, `packages/theme`, `packages/i18n`** : squelettes typés, sans logique (remplis aux lots 1 et 2).
5. **`apps/mobile`** : Expo SDK 58 + Expo Router + TypeScript, un écran d'accueil vide, cible web active. Config prête pour Stripe : nouvelle architecture, `expo-build-properties` avec `useFrameworks: "dynamic"`, `eas.json` avec profils `development`, `preview`, `production`. Metro configuré pour le monorepo pnpm.
6. **`apps/admin`** : Next.js 16, App Router, page vide « Back-office Splash360 ».
7. **`apps/api`** : serveur Node (Hono) avec une route `GET /health`, qui importe `@splash360/core` ; c'est là que vivront création de commande, paiement et webhooks.
8. **Base** : `supabase init`, première migration avec la table `tenants` uniquement (le reste au lot 1), un test RLS minimal.
9. **Intégration continue** : GitHub Actions avec `pnpm install`, `lint`, `typecheck`, `test` à chaque push et pull request.
10. **Environnements** : `.env.example` par application, documentation dev/recette/prod dans `CLAUDE.md` ; mise à jour de la section « Commandes ».

## Vérification du critère

- `pnpm install && pnpm typecheck && pnpm test` passe en local et en CI.
- `pnpm --filter mobile web` affiche l'écran d'accueil ; `pnpm --filter admin dev` affiche la page ; `curl localhost:<port>/health` répond `ok`.
- iOS et Android : `npx expo start` démarre le bundler (le build de développement EAS demande un compte Expo, fourni plus tard).

## Questions avant de coder

1. **Serveur de la commande en ligne** : je propose `apps/api` (Node + Hono, hébergé dans l'UE), parce qu'il réutilise directement `packages/core`. L'alternative est Supabase Edge Functions (Deno), mais partager le code du monorepo y est moins simple. On part sur `apps/api` ?
2. **Base locale** : `supabase start` demande Docker. Tu l'as sur ta machine ? Sinon on se contente pour l'instant des migrations et des tests RLS lancés en CI.
3. **Hébergement** (non bloquant pour le lot 0) : Vercel pour le back-office et le web, et un hébergeur UE pour `apps/api` (Scaleway, Fly.io région Paris…) ? On peut trancher avant le lot 7.
4. **Compte Expo / EAS** : à créer au nom de Splash360 avant le lot 4 (Apple Pay et Google Pay exigent un build de développement).
