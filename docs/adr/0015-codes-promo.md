# ADR 0015 — Codes promo gérés au back-office

Date : 2026-11-23 · Statut : acceptée

## Contexte

Le propriétaire veut un champ « code promo » avant le paiement, et que chaque enseigne crée ses codes
elle-même dans le back-office (décision du 23/11/2026, plutôt que dans Splash360).

## Décision

1. **Règles** (`@splash360/core`, `applyPromo`) : pourcentage (1 à 100) ou montant fixe en centimes,
   sous-total minimum, dates de début et de fin, nombre total d'utilisations, **une utilisation par
   client**. La remise porte sur les articles **après** la récompense fidélité ; les frais ne sont jamais
   remisés ; il reste toujours au moins 0,50 € à payer. Les points fidélité se gagnent sur le montant payé.
2. **Données** : `promo_codes` (code en majuscules, unique par enseigne) et `promo_redemptions`
   (une ligne par commande, unique par code et identité de client `contact_key`, membre du club noté).
   RLS activée sans politique : tout passe par l'API (ADR 0002). La commande garde `promo_code` et
   `promo_discount_cents` (contrainte de total mise à jour).
3. **Contrôles** : le devis vérifie le code (et, pour un membre connecté, s'il l'a déjà utilisé) ; la
   création de commande revérifie **sous verrou du code** le plafond d'utilisations et l'usage par ce
   client, puis enregistre l'utilisation dans la même transaction.
4. **Application** : champ « Code promo » au récapitulatif, codes gardés dans « Mes codes promo » et
   proposés d'une touche ; un code refusé est retiré avec son motif.
5. **Back-office** : page « Codes promo » (administrateurs de l'enseigne) : créer, désactiver/réactiver,
   nombre d'utilisations ; chaque action est journalisée.

## Conséquences

- Une commande annulée garde son utilisation du code (simple et sans abus possible) ; à revoir si besoin.
- Si Splash360 gère un jour ses propres promotions, `applyPromo` reste la règle ; seule la source des codes
  changera.
