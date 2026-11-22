# 0001 — Monorepo pnpm/Turborepo et serveur `apps/api` en Hono

**Statut** : acceptée (2026-11-22)

## Contexte

Le cahier des charges impose trois applications (client Expo, back-office Next.js, serveur) qui partagent types, thème et règles de prix. Le serveur porte les opérations critiques : calcul des montants, paiement, webhooks Stripe, envoi à la caisse.

## Décision

- Monorepo pnpm + Turborepo ; paquets internes `@splash360/*` en TypeScript source.
- Serveur dédié `apps/api` en Node 22 + Hono, qui importe directement `@splash360/core`.
- Supabase Edge Functions écartées : runtime Deno, partage du code du monorepo plus fragile, transactions SQL moins naturelles.

## Conséquences

- Une seule implémentation des règles de prix, testée une fois, utilisée partout.
- Un service Node à héberger (région UE) et à superviser ; Hono reste portable (Node, conteneur, edge) si l'hébergement change.
