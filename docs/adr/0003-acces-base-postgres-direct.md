# 0003 — Accès à Postgres en direct depuis le serveur

**Statut** : acceptée (2026-11-22)

## Contexte

La création de commande, le traitement idempotent des webhooks et la réservation des créneaux exigent des transactions SQL et des verrous. supabase-js passe par PostgREST, qui ne permet pas de transaction sur plusieurs requêtes.

## Décision

- `apps/api` se connecte à Postgres avec postgres.js (`DATABASE_URL`, rôle serveur), via `packages/db`.
- Requêtes SQL paramétrées écrites à la main, types de lignes explicites ; chaque requête filtre par `tenant_id`.
- Le code métier dépend d'interfaces de dépôt ; une implémentation en mémoire sert aux tests unitaires, l'implémentation Postgres est testée en intégration en CI.

## Conséquences

- Transactions et verrous disponibles ; aucun lien avec PostgREST côté serveur.
- Le rôle serveur contourne la RLS : le filtrage par enseigne dans chaque requête est obligatoire et couvert par les tests d'intégration.
