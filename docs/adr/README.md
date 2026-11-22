# Décisions d'architecture (ADR)

Une décision structurante = un fichier `NNNN-titre.md`, jamais réécrit : on en ajoute un nouveau qui remplace l'ancien.
Format : Contexte, Décision, Conséquences, Statut.

| N°                                         | Décision                                                                           | Statut   |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-et-serveur-hono.md)   | Monorepo pnpm/Turborepo, serveur `apps/api` en Hono                                | Acceptée |
| [0002](0002-le-client-passe-par-l-api.md)  | Le client ne lit jamais la base : tout passe par `apps/api`                        | Acceptée |
| [0003](0003-acces-base-postgres-direct.md) | Le serveur accède à Postgres en direct (postgres.js), pas via supabase-js          | Acceptée |
| [0004](0004-resolution-de-l-enseigne.md)   | Résolution de l'enseigne : sous-domaine sur le web, variable de build sur mobile   | Acceptée |
| [0005](0005-back-office-auth.md) | Back-office : identité Supabase Auth, droits et données via `apps/api`, journal d'audit | Acceptée |
| [0006](0006-carte-de-demonstration.md) | Carte et caisse de démonstration en attendant l'API Splash360 | Acceptée |
