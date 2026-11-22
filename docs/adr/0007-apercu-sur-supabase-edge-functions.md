# 0007 — Aperçu et recette : l'API servie par une fonction Supabase

## Contexte

Pour voir l'application complète avant le dépôt sur les stores, l'API (`apps/api`) doit être joignable
en ligne. La cible de production reste un serveur Node conteneurisé (ADR 0001, `apps/api/Dockerfile`),
mais construire et pousser une image demande un hébergeur et un pipeline à configurer.
Le projet Supabase de recette existe déjà et sait exécuter du code serveur (runtime Deno).

## Décision

- `apps/api/src/edge.ts` sert la même application Hono sous `https://<projet>.supabase.co/functions/v1/api/…`.
- `pnpm --filter api build:edge` produit `dist/edge/index.js` (code interne regroupé par esbuild)
  et `dist/edge/deno.json` (zod, stripe, postgres, jose en `npm:` aux versions du lockfile).
- Connexion à la base via `SUPABASE_DB_URL`, fournie par Supabase ; clé des jetons de suivi dérivée
  de la clé de service si `ORDER_TOKEN_SECRET` n'est pas posé.
- Pas de tâche de fond : l'expiration des commandes non payées est déclenchée au fil des requêtes
  (au plus une fois par minute et par instance) ; l'envoi à la caisse reste immédiat après paiement.
- Paiement actif seulement si `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` et `STRIPE_WEBHOOK_SECRET`
  sont posés en secrets de fonction (mode test).
- La fonction est déployée avec `verify_jwt = false` : l'API fait sa propre authentification
  (jetons de suivi, Supabase Auth pour le back-office, signatures des webhooks).

## Conséquences

- Aperçu en ligne sans infrastructure supplémentaire ; même code métier que la production.
- Les relances de la caisse (tâche périodique) ne tournent pas : acceptable avec la caisse de démonstration.
- Avant la production réelle, l'API repasse sur le serveur Node (Dockerfile) ; cet ADR ne remplace pas l'ADR 0001.

## Statut

Acceptée (aperçu et recette).
