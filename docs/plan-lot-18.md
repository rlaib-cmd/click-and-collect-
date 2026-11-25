# Lot 18 — Cartes bancaires enregistrées

**Demande** (25 novembre, « La carte bancaire ») : enregistrer sa carte dans le profil, puis payer
plus vite. Décisions : ADR 0023.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Base : `stripe_customers` (client Stripe de la plateforme par membre et par enseigne), RLS, pgTAP, tests Postgres |
| 2 | Contrats : carte (marque, 4 derniers chiffres, expiration, par défaut), SetupIntent, paiement avec carte enregistrée (`returnUrl` https ou schéma d'application) |
| 3 | API : `GET/POST/DELETE …/loyalty/me/cards…` (jeton de membre, carte revérifiée chez Stripe), `POST …/orders/:id/payment/saved-card` (jeton de commande + `X-Member-Token`, caisse prête, même PaymentIntent, carte clonée vers le compte du restaurant, 3-D Secure renvoyé à l'application), débit limité |
| 4 | Application : « Mes moyens de paiement » (liste, ajout par Payment Element ou feuille Stripe, carte par défaut, suppression avec confirmation) ; au paiement, « Payer avec Visa •••• 4242 » au-dessus des autres moyens, 3-D Secure par `handleNextAction` (web et natif) |

## Vérifications

- Tests de routes (`apps/api/src/routes/cards.test.ts`) : session obligatoire, ajout / liste / par
  défaut / suppression, cloisonnement entre membres et entre enseignes, paiement (montant du serveur),
  3-D Secure, refus, Stripe absent.
- Tests Postgres (`stripe-customers.integration.test.ts`) et pgTAP (`stripe_customers_test.sql`) sur
  une base locale migrée.
- Recette, Stripe en mode test, par appels d'API (voir le compte rendu du lot).

## Ce qui reste

1. Enregistrer la carte pendant un paiement (voir ADR 0023, conséquences).
2. Application installée : nouveau build EAS pour le 3-D Secure natif ; la version web l'a déjà.
3. Production : migration `20261125080000_stripe_customers.sql` puis fonction `api`.
