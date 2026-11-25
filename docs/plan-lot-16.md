# Lot 16 — Fidélité dans le click & collect et inscription

**Demande** (25 novembre) : paliers par catégories entières, cadeau mis en avant dans le click &
collect et visible jusqu'au ticket, inscription « Fais connaissance » facultative, trois produits
Bills Burger mis en avant. Décisions : ADR 0021.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Règle `rewardIncludes` (`packages/core`) : produit listé ou d'une catégorie du palier ; devis serveur refuse sinon (`reward_product_not_eligible`) |
| 2 | Base : `loyalty_reward_settings` (RLS, pgTAP), `loyalty_demo_members.birth_date` ; migration `20261125071600_loyalty_rewards_profile.sql` ; seed Bills Burger |
| 3 | API : `GET/PUT /v1/admin/loyalty/rewards`, `PATCH /v1/tenants/:s/loyalty/me`, programme avec `categoryIds`, lignes du suivi avec `gift` |
| 4 | Application : bandeau cadeau sur la carte du restaurant (« Tu as X points : … offert », sinon « Encore Y points »), choix du produit, « Offert » au panier, au récapitulatif et au ticket ; Avantages liste tous les produits du palier (aussi pour un visiteur) |
| 5 | Inscription : écran « Fais connaissance » après le code (prénom, e-mail, date de naissance, « Passer »), puis la carte ; Compte → « Mes informations » |
| 6 | Back-office : Fidélité → « Cadeaux des paliers » (cases à cocher des catégories de la carte) |

## Mise en recette (non faite dans ce lot, à valider)

1. Migration `supabase/migrations/20261125071600_loyalty_rewards_profile.sql`.
2. Script de données recette (catégories des paliers et trois produits mis en avant de Bills
   Burger), fourni à part, hors dépôt.
3. Déploiement de l'API, du back-office et de l'application web.

## Ce qui reste

1. Prénom facultatif dès la création du compte : dépend du fournisseur de fidélité et de la caisse
   (voir ADR 0021).
2. Usage de la date de naissance (offre anniversaire) : non demandé, non construit.
