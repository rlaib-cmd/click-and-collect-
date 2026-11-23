# ADR 0014 — Cadeaux par paliers, produit offert au choix

Date : 2026-11-23 · Statut : acceptée

## Contexte

Dans l'application fidélité Splash360, un palier (« 30 points ») propose plusieurs produits au choix
(Coca Cherry, Coca, Coca Zero). Notre modèle « un cadeau = un produit » ne permettait pas ce choix, et
le client devait ajouter lui-même le produit au panier avant de pouvoir l'utiliser.

## Décision

1. **Palier** : `LoyaltyReward { id, name, costPoints, productIds[] }` (au moins un produit de la carte
   Splash360). Le client choisit un produit du palier.
2. **Règle** (`applyReward`, `@splash360/core`) : le produit choisi doit appartenir au palier
   (`reward_product_not_eligible` sinon), être au panier et le solde disponible (moins les points
   réservés, ADR 0013) suffire ; le prix de base d'une unité est déduit, il reste au moins 0,50 € à payer.
3. **Échanges** : le devis et la commande reçoivent `rewardId` et `rewardProductId` ; sans produit
   (anciennes versions), le premier produit du palier présent au panier. La commande garde le produit
   choisi (`orders.loyalty_reward_product_id`).
4. **Application** : le cadeau choisi est retenu dans le panier (`cart.reward`), qu'il vienne de l'écran
   Avantages (pont « Choisir » → panier, ou fiche produit en mode cadeau s'il faut des options) ou du
   récapitulatif. Il disparaît si son produit quitte le panier, et n'est pas reconduit en recommandant.
5. **Prochain palier** : `nextReward` (le moins cher au-dessus du solde disponible) alimente la carte
   « Ma fidélité » (photo du cadeau, points manquants, jauge).

## Conséquences

- L'API fidélité Splash360 devra exposer les paliers avec leurs produits au choix, et la consommation
  d'un cadeau devra porter le produit choisi (à ajouter à `questions-en-attente.md`).
- Les identifiants de paliers de démonstration sont conservés (`rw-bb-frites`…) : les commandes passées
  restent lisibles.
