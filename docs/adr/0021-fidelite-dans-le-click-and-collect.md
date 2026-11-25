# ADR 0021 — Fidélité dans le click & collect : paliers par catégories, cadeau sur le ticket, profil facultatif

Date : 2026-11-25 · Statut : acceptée

## Contexte

Demandes du 25 novembre (lot 16) :

- un palier doit pouvoir offrir **toute une catégorie** (« pour 500 points, toutes les boissons ;
  pour 900 points, tous les burgers »), pas seulement une liste de produits fixée par le programme ;
- le click & collect doit mettre le cadeau en avant (« Tu as X points : une boisson offerte »), le
  client choisit son produit, qui apparaît offert dans le panier, le récapitulatif **et** le ticket ;
- après le code de connexion (inscription), proposer « Fais connaissance » : prénom, e-mail, date de
  naissance, **tous facultatifs** (« Passer »), puis la carte de membre ; modifiable dans Compte.

Le programme (paliers, coût en points, produits listés) vient du fournisseur de fidélité
(`packages/api-loyalty`, démonstration en attendant l'API Splash360, ADR 0014). Celui-ci ne connaît
pas la carte du restaurant.

## Décision

1. **Catégories par palier = réglage de l'enseigne chez nous.** Table `loyalty_reward_settings`
   (`tenant_id`, `reward_id`, `category_ids`, RLS, pgTAP). Un décorateur du fournisseur
   (`apps/api/src/loyalty/reward-settings.ts`) ajoute `categoryIds` à chaque palier : application,
   devis, back-office lisent tous le même programme fusionné. Réglage au back-office (Fidélité →
   « Cadeaux des paliers », droit `loyalty`, journalisé).
2. **Contrôle serveur inchangé dans son principe** : `rewardIncludes` (`packages/core`) accepte un
   produit listé **ou** de l'une des catégories du palier (catégorie lue dans la carte serveur) ;
   sinon `reward_product_not_eligible`. La remise reste le prix de base d'une unité (ADR 0014).
3. **Cadeau sur le ticket** : déduit côté serveur du produit offert figé sur la commande
   (`loyalty_reward_product_id`) ; le suivi marque la ligne `gift: true` et affiche la remise
   fidélité. L'application n'envoie toujours que des identifiants.
4. **Profil facultatif** : `PATCH /v1/tenants/:s/loyalty/me` (prénom, e-mail, date de naissance ;
   e-mail déjà pris → 409). Date de naissance stockée en `date`, bornée 1900 → aujourd'hui.
   Le prénom saisi à la création du compte (étape existante du lot 10, avec l'acceptation des
   conditions) reste demandé : c'est le nom affiché sur la carte et transmis à la caisse ; l'écran
   « Fais connaissance » le reprend modifiable, l'e-mail et la date sont facultatifs.

## Conséquences

- Quand l'API fidélité Splash360 sera branchée, le réglage des catégories reste chez nous tant
  qu'elle ne le porte pas ; si elle le porte, le décorateur s'efface.
- Rendre le prénom lui-même facultatif à la création demanderait un nom de membre facultatif dans
  le fournisseur de fidélité et à la caisse : question ouverte (`docs/questions-en-attente.md`).
- Les produits « mis en avant » de Bills Burger (Cheesy smash, Smoke, Honey) utilisent le mécanisme
  existant (`menu_overrides.featured`), sans changement de schéma.
