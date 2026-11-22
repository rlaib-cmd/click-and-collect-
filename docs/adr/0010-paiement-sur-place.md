# 0010 — Paiement sur place

## Contexte

Le cahier des charges (V1) impose le paiement en ligne. Les enseignes veulent aussi laisser payer au
comptoir (espèces, carte), notamment tant que Stripe n'est pas branché, avec un QR code à présenter
en arrivant au restaurant.

## Décision (validée par le responsable produit)

- Option **par restaurant** (`restaurant_settings.pay_on_site_enabled`, réglée au back-office).
  Le client choisit « Payer en ligne » ou « Payer sur place » ; sans Stripe, seul « sur place » est proposé.
- Réservé aux **membres connectés du club fidélité** (lutte contre les fausses commandes),
  contrôlé par `core.checkPaymentMethod` et par une contrainte en base.
- La commande est créée au statut **`confirmed`** et envoyée **tout de suite** en caisse
  (`pos_dispatches` dans la même transaction). Elle n'est **jamais** marquée `paid` : la règle
  « payée uniquement sur webhook Stripe vérifié » reste entière (contrainte en base).
- `confirmed` tient la place de `paid` dans le parcours (acceptée, en préparation, prête, remise).
- Chiffre d'affaires : une commande sur place compte une fois **remise** (encaissée au comptoir).
- Fidélité : points crédités et récompense consommée à la **remise**, pas à la commande.
- Un QR code (`pickupCode`, format provisoire `S360-CMD-<numéro>-<8 caractères>`) est affiché au
  client pour retrouver la commande au comptoir ; le format définitif dépend de la caisse Splash360.

## Conséquences

- Risque de commande non retirée : limité au compte club ; la caisse peut annuler.
- Remboursement en ligne impossible pour ces commandes (aucun paiement Stripe).

## Statut

Acceptée.
