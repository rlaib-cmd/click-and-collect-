# Lot 24 — Promotions de catalogue de la caisse et formules à trois niveaux

**Demande** (propriétaire, 26/11) : appliquer en ligne, exactement comme la caisse, les promotions
de catalogue Splash360 (`reglescatalogue`), d'après la réponse faisant foi du directeur technique
de Splash360 (relevée dans le code de la caisse, `release/version-1.4.x`, transcrite dans
`docs/api-splash360/analyse-api-click-collect.md`) ; gérer les étapes imbriquées des formules
jusqu'à trois niveaux. Décisions : ADR 0030.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | `packages/core/src/catalog-rules.ts` : `CatalogRule`, `activeCatalogRules` (mode, dates, règles ignorées), `discountedCount` (lots de `max`, rangs `min` à `max`), `applyCatalogRules` (moins chers d'abord en `all`, produit par produit en `one`, `quantite`, une remise par article, articles réservés par le cadeau, remise commande unique sur le total déjà remisé, code promo prioritaire, frais), `applyCatalogToTotals` (commande jamais gratuite), `promotedProducts` (badge) ; `Totals.catalogDiscountCents` / `catalogFeeCents` ; code promo calculé après les remises de catalogue |
| 2 | `packages/api-menu` : `reglescatalogue` lu avec tolérance (`parseCatalogRules`, `parseRuleValue`), règles sur `Menu.catalogRules` |
| 3 | Migration `20261129000000_catalog_promotions.sql` : `orders.catalog_discount_cents`, `catalog_fee_cents`, `catalog_adjustments`, `order_items.discounts`, contrainte du total ; devis (cadeau → promotions → code promo → points), commande figée, contrats (`discounts` par ligne, `adjustments`, totaux), carte avec `promo` par produit |
| 4 | Caisse : remise d'article par article remisé dans `items[].modificateurs` (pourcentage, `origin` « bogo », nom exact), remise de commande « 10% »/« 5€ », frais de règle ; cadeau fidélité envoyé en remise d'article |
| 5 | Application : badge « Promo », rappel au panier, remises sous les lignes et dans les totaux du récapitulatif, promotions au suivi ; back-office : remises sous la ligne et détail du total |
| 6 | Formules : `MAX_NESTING_DEPTH` = 3, traduction récursive (`a>b>c>d`), étape active seulement si toute sa chaîne de parents est choisie (serveur et application), `parentid` = parent direct, retrait par niveau dans la fiche produit |

## Vérifications

- Core (`catalog-rules.test.ts`) : 4/4, 3/3, 2/3, 0/0, `min` > 0 et `max` = 0 ignorée,
  `quantite`, `one` contre `all`, moins chers d'abord (10, 10, 6, 4 € → 4 €), 8 → 2 et 7 → 1,
  copies par mode, dates (`end` = 0), une remise par article (première règle), cadeau prioritaire,
  40 − 10 − 3 = 27 €, deux remises de commande, code promo qui l'emporte, frais en euros et en
  pourcentage, remise en euros convertie en pourcentage (« 39.04% »), commande jamais gratuite,
  code promo après la 4e offerte.
- Carte (`menu.test.ts`) : extrait réel de Chicken Street, `end` = 0, `selection` « one »,
  règles illisibles écartées, valeurs (« 100% », « 3,9€ », « 150% » plafonné) ; trois niveaux
  d'étapes, quatrième ignoré.
- Devis et commande (`catalog-promotions.test.ts`, api) : 4e offerte sur la moins chère, ligne
  figée et affichée au back-office, mode et dates, remise et frais de commande, code promo,
  cadeau fidélité non compté, points sur le montant payé, commande gratuite refusée, badge par mode.
- Caisse (`splash360.test.ts`) : remises d'article (une par article, pourcentage, nom exact),
  remise et frais de commande, cadeau en remise d'article ; ingrédients sur trois niveaux.
- Calcul (`pricing.test.ts`) et application (`selection.test.ts`) : profondeurs 2 et 3, parent
  manquant refusé, décocher un parent vide toute la descendance.
- Postgres (`ordering.integration.test.ts`) : promotions figées et relues, total incohérent refusé.

## Ce qui reste

- Faire confirmer par Splash360 les hypothèses de l'ADR 0030 (questions en attente n° 23), en
  particulier « options comprises » et le format de la remise d'article du cadeau fidélité.
- Recette sur Chicken Street Siège (1274) avec la règle réelle « 3 acheter = 1 » : comparer le
  total en ligne et le total du ticket de caisse.
