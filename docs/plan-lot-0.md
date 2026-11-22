# Plan — Lot 0 : Socle

**Critère d'acceptation (section 9)** : les trois applications démarrent ; les tests et le contrôle de types passent.

Statut : **réalisé le 2026-11-22.** Voir « Bilan » en fin de document.

## Versions relevées le 2026-11-22 (registre npm)

| Outil | Version |
|---|---|
| Expo SDK | 58 (`expo` 58.0.26, `expo-router` 58.0.x) |
| React Native | celle imposée par le SDK 58 (`npx expo install`) |
| `@stripe/stripe-react-native` | 0.81.0 pour le SDK 58 (table de compatibilité Expo ; 0.85 est la dernière publiée) |
| Next.js | 16.4.x |
| `stripe` (Node) | 23.x |
| `@supabase/supabase-js` / CLI `supabase` | 2.119.x / 3.2.x |
| Turborepo | 2.11.x |
| pnpm | 10.28 |
| TypeScript | 6.0 (version du gabarit Expo 58) |
| Vitest | 5.x |
| Node | 22 LTS |

Point d'attention : TypeScript 7 est sorti, mais typescript-eslint ne le supporte pas encore (< 6.1). On reste sur TypeScript 6.0, celui du gabarit Expo 58.

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

## Décisions prises

1. **Serveur** : `apps/api` en Node + Hono, qui réutilise `packages/core`. Hébergement UE à choisir avant le lot 7.
2. **Base** : pas de Docker requis sur le poste. Les migrations et les tests pgTAP tournent en CI (`supabase db start` puis `supabase test db`).
3. **Accès aux tables** : RLS activée et aucun accès pour `anon` et `authenticated` tant que les comptes du back-office n'existent pas (lot 1 et 6). Un test générique vérifie que toute table publique a la RLS et une colonne `tenant_id`.
4. **Web Expo** : export statique (`web.output: "static"`).

## Bilan

- Les trois applications démarrent : export web et bundle iOS Expo OK, build Next.js OK, `GET /health` de l'API répond `ok`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` passent (22 tâches Turborepo).
- Migration et tests pgTAP validés sur Postgres local (5/5 ; ils échouent bien si la RLS est désactivée).

## Reste à faire hors code

- Compte Expo / EAS au nom de Splash360 (nécessaire au lot 4 pour Apple Pay et Google Pay), puis `eas init` pour lier le projet.
- Documentation de l'API menu Splash360 dans `docs/api-splash360/` (bloque le lot 2).
- Projets Supabase de recette et de production (région UE).
