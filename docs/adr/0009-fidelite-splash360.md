# 0009 — Fidélité Splash360 dans l'application de commande

## Contexte

Les enseignes ont déjà une app fidélité (club, points, récompenses, QR code en caisse) dont les règles,
les comptes clients et les QR codes sont gérés par Splash360. Elles veulent une seule application :
commande en ligne et fidélité. L'API fidélité de Splash360 n'est pas encore fournie.

## Décision

- `packages/api-loyalty` est le **seul** client de l'API fidélité Splash360 (même principe que
  `api-menu`). Interface `LoyaltyProvider` : programme, adhésion, membre, historique, règlement d'une commande.
- En attendant l'API : **fournisseur de démonstration** (programmes de test Bills Burger et Chicken Street,
  données dans `loyalty_demo_members` / `loyalty_demo_movements`, RLS fermée). Variable `LOYALTY=demo|off`.
- Calculs dans `packages/core` : `pointsForAmount` (sur le total payé) et `applyReward` (produit offert,
  prix de base déduit). L'application n'envoie que son jeton de membre et l'identifiant de la récompense.
- Jeton de membre : HMAC lié à l'enseigne (« identifiant_signature »), comme les jetons de suivi.
- Les points sont crédités et la récompense consommée **au paiement confirmé** (webhook Stripe),
  une seule fois par commande (contrainte d'unicité + marque `loyalty_settled_at`).
- Connexion par simple e-mail : **données de test uniquement** (`LOYALTY_DEMO_LOGIN=1`), jamais en production ;
  sans elle, une adhésion avec un e-mail déjà inscrit est refusée.
- Navigation de l'application : 5 onglets, Commander au centre (maquette option A validée).

## Conséquences

- Brancher l'API Splash360 = écrire un second `LoyaltyProvider`, sans toucher l'API ni l'application.
- À obtenir de Splash360 : vérification du client (code), réservation de la récompense à la commande
  (aujourd'hui recontrôlée au devis puis consommée au paiement), annulation des points au remboursement.

## Statut

Acceptée (données de test).
