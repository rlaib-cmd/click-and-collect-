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
| [0007](0007-apercu-sur-supabase-edge-functions.md) | Aperçu et recette : API servie par une fonction Supabase | Acceptée |
| [0008](0008-style-de-l-enseigne.md) | Style de l'enseigne : en-tête, angles, titres, motif | Acceptée |
| [0009](0009-fidelite-splash360.md) | Fidélité Splash360 : `api-loyalty`, données de test, points au paiement | Acceptée |
| [0010](0010-paiement-sur-place.md) | Paiement sur place : option par restaurant, membres du club, statut « confirmée » | Acceptée |
| [0011](0011-administration-plateforme.md) | Administration de la plateforme : bloquer, supprimer, club fidélité | Acceptée |
| [0012](0012-connexion-client-par-code.md) | Connexion du client par code SMS ou e-mail, téléphone identifiant principal | Acceptée |
| [0013](0013-email-facultatif-et-reservation-des-points.md) | E-mail facultatif à la commande, points du cadeau réservés | Acceptée |
| [0014](0014-paliers-de-cadeaux.md) | Cadeaux par paliers, produit offert au choix | Acceptée |
| [0015](0015-codes-promo.md) | Codes promo gérés au back-office | Acceptée |
| [0016](0016-studio-design.md) | Studio design : brouillon, aperçu fidèle, publication sans les stores | Acceptée |
| [0017](0017-roles-du-back-office.md) | Rôles du back-office : propriétaire, gérant, équipier ; matrice de droits unique | Acceptée |
| [0018](0018-caisse-splash360-avant-paiement.md) | Branchement réel Splash360 : la caisse accepte la commande avant le paiement | Acceptée |
