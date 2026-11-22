# Lot 8 — Fidélité dans l'application de commande

**Demande** : une seule application par enseigne, commande en ligne et club fidélité ensemble
(maquette option A : 5 onglets Accueil · Avantages · **Commander** · Ma carte · Compte).
La fidélité (règles, compte client, QR code) est gérée par **Splash360** ; son API sera fournie plus tard.
En attendant : **données de test**, comme la carte (ADR 0006 → ADR 0009).

## Règles métier (dans `packages/core`, testées)

- Points gagnés = `floor(montant payé en centimes × points par euro / 100)`, sur le total réellement payé
  (après récompense). Crédités une seule fois par commande, au paiement confirmé (webhook Stripe).
- Récompense « produit offert » : le prix de base du produit (sans options) est déduit, une seule
  récompense par commande ; elle exige ce produit dans le panier et assez de points.
- Le minimum de livraison et la livraison offerte se jugent sur le sous-total **avant** récompense.
- Total = sous-total + livraison + service − récompense ; il doit rester au moins 0,50 € à payer
  (minimum encaissable par carte), sinon la récompense est refusée.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | `core` : `discountCents` dans les totaux, `pointsForAmount`, `applyReward` |
| 2 | `packages/api-loyalty` : interface `LoyaltyProvider` (seul client de l'API fidélité Splash360) + fournisseur de démonstration |
| 3 | Base : colonnes de récompense sur `orders`, tables de démonstration de la fidélité |
| 4 | API : programme, adhésion, membre (points, QR), récompense dans devis et commande, points au paiement |
| 5 | Application : barre à 5 onglets, Accueil fidélité, Avantages, Ma carte (QR), Compte, récompense au panier |

## Statut

Étapes 1 à 5 livrées et testées (core 47 tests, API 67, pgTAP fidélité 4, intégration Postgres dont
un règlement concurrent). Parcours vérifié dans un navigateur : inscription, QR code, Avantages,
récompense au récapitulatif (refusée si rien ne reste à payer : minimum Stripe 0,50 €).

## Limites assumées des données de test

- **Connexion sans vérification** : en démonstration, un e-mail suffit pour retrouver son compte.
  L'API Splash360 devra fournir la vérification (code par SMS ou e-mail). Désactivé en production.
- Programme de test : 10 points par euro, 100 points de bienvenue, récompenses Frites 400, Boisson 500,
  Cheeseburger 900, Menu complet 1600 (repris de la vidéo de l'app fidélité).

## Questions pour Splash360 (voir `questions-en-attente.md`)

API fidélité : création de compte, vérification, solde, historique, QR code (format), crédit des points
d'une commande en ligne (idempotence), consommation d'une récompense, annulation en cas de remboursement.
