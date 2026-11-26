# ADR 0030 — Promotions de catalogue de la caisse et formules à trois niveaux

- Statut : acceptée (26 novembre 2026)
- Liens : réponse du directeur technique de Splash360 du 26/11 (relevée dans le code de la caisse,
  branche `release/version-1.4.x`), transcrite dans `docs/api-splash360/analyse-api-click-collect.md`
  (« Règles de catalogue ») ; ADR 0015 (codes promo), ADR 0014 et 0021 (cadeaux fidélité), ADR 0024
  (Splash360 v2, étapes imbriquées) ; plan `docs/plan-lot-24.md`.

## Contexte

La caisse applique à la réception d'une commande les promotions de catalogue définies au
back-office Splash360 (`reglescatalogue` de la carte : « 3 achetés = 1 offert »…). Faute d'en
connaître les règles, nous ne les appliquions pas : le client payait en ligne plus que le total de
la caisse (questions en attente n° 20). Splash360 a donné le sens exact de chaque champ, la règle
de choix de l'article remisé, la répétition, le cumul et le format d'envoi. Par ailleurs la caisse
gère trois niveaux d'étapes imbriquées dans une formule ; nous n'en gérions qu'un.

## Décisions

### Lecture (`packages/api-menu`)

- `reglescatalogue` est lu avec tolérance (`parseCatalogRules`) : champs inconnus ignorés, règle
  illisible écartée (mode autre que `surplace`/`emporter`/`livraison`/`all`, valeur qui n'est ni
  « N% » ni « N€ », opération autre que -1/+1) ; une liste illisible n'empêche pas la carte.
- Règle interne `CatalogRule` (`packages/core`) : `value` en centièmes de point (10 000 = 100 %)
  ou en centimes, `valueLabel` gardé tel que reçu, `end` = 0 → sans fin, `selection` autre que
  `one` → `all`, `taux` gardé (`vatRate`). Toutes les copies sont gardées sur `Menu.catalogRules`,
  dans l'ordre reçu (l'ordre fait la priorité) ; la carte envoyée à l'application n'en publie que le
  nom, par produit, pour le badge « Promo » (`promo`).

### Calcul (`applyCatalogRules`, fonction pure, horloge injectée)

- **Règles en vigueur** : copie du mode de la commande (à emporter → `emporter`, livraison →
  `livraison`) ou `all` ; `start` ≤ maintenant ≤ `end` (horloge du serveur) ; `min` > 0 avec
  `max` = 0 : ignorée ; frais (`operation` +1) sur des produits : ignorés.
- **Nombre d'articles remisés** (`discountedCount`) : articles comptés par lots de `max`, rangs
  `min` à `max` de chaque lot remisés, par rang dans le lot (4/4 : 7 → 1, 8 → 2 ; 2/3 : 2e et 3e ;
  0/0 : tous) ; `quantite` plafonne le nombre par commande (0 = sans limite).
- **Quels articles** : `all` → les moins chers parmi tous les articles des produits de la liste ;
  `one` → produit par produit (4 Coca oui, 2 Coca + 2 Fanta non), sur les lignes de ce produit.
  Prix d'un article = prix unitaire de la ligne, **options comprises** (hypothèse, voir plus bas).
- **Montant** : pourcentage du prix unitaire arrondi au centime le plus proche ; montant en euros
  plafonné au prix de l'article. Nos totaux gardent les centimes exacts.
- **Règle sans produits** : remise ou frais sur toute la commande, calculés sur le total déjà
  remisé (articles, cadeau) : 4e offerte puis 10 % sur 40 € → 40 − 10 − 3 = 27 €. `min`/`max`/
  `quantite` n'y servent pas.
- **Cumul**, comme la caisse :
  - un article ne reçoit qu'une remise, celle de la première règle de la liste ; un article
    remisé n'est plus compté par les règles suivantes ;
  - une remise existante est prioritaire : l'article offert par le **cadeau fidélité** (une unité
    du produit choisi, la première ligne de ce produit) n'est ni compté ni remisé ;
  - une seule remise sur la commande : la première règle sans produits ; le **code promo du
    client** est une remise sur la commande déjà présente, donc **le code gagne** : avec un code,
    aucune remise commande de règle (les remises d'articles restent) ;
  - les frais de règle s'ajoutent tous.
- **Ordre du devis** (serveur, seule source des montants) : panier → frais et minimum de livraison
  (sous-total avant remises, inchangé) → cadeau fidélité → promotions de catalogue → code promo
  (calculé sur le sous-total moins le cadeau et les remises de catalogue) → points gagnés sur le
  montant payé. Une commande rendue gratuite par les promotions est refusée
  (`catalog_needs_paid_amount`), comme pour le cadeau et le code.

### Stockage

- `orders.catalog_discount_cents` (remises articles + commande), `orders.catalog_fee_cents`,
  `orders.catalog_adjustments` (remise et frais de commande figés : nom, valeur, montant, taux) ;
  `order_items.discounts` (par ligne : règle, nom, articles remisés, remise unitaire, pourcentage
  envoyé). Contrainte du total mise à jour. Pas de nouvelle table (RLS inchangée).

### Envoi à la caisse (`submitcommande`, format de la borne `setCommandeFromAPI`)

- **Remise d'article** : dans `items[].modificateurs`, une entrée **par article remisé** :
  `{ type: "discount", origin: "bogo", nom: <nom exact de la règle>, operation: -1, valeur: "100%",
  itemOnly: true }`. La caisse découpe la ligne. La valeur est **toujours un pourcentage** : une
  remise en euros est convertie en pourcentage du prix unitaire de l'article, arrondi au centième
  de point (3,90 € sur 9,99 € → « 39.04% ») ; la caisse peut donc retrouver un centime d'écart sur
  ces seules règles, nos totaux restant exacts.
- **Remise sur la commande** : `modificateurs` de la commande, `{ type: "discount", valeur:
  "10%" | "5€" (valeur de la règle telle que reçue), nom: <nom exact>, operation: -1 }`.
- **Frais de règle** : modificateur `frais` au format du 26/11, `modificateur_id` = identifiant de
  la règle, `nom` = nom de la règle, `valeur` = valeur de la règle, `taux` = `taux` de la règle
  (TVA des frais par défaut).
- **Cadeau fidélité** : désormais envoyé comme **remise d'article** sur l'article offert
  (`origin: "loyalty"`, `nom: "Cadeau fidélité"`, prix de base offert en pourcentage du prix
  unitaire), pour que la caisse le traite comme une remise existante et ne lui applique pas de
  promotion. Une ancienne commande sans produit offert connu garde la remise sur la commande.
- Code promo et frais de livraison et de service : inchangés.

### Affichage

- Application : badge « Promo » sur les produits d'une règle en vigueur pour le mode ; au panier,
  rappel « remise calculée au récapitulatif » ; au récapitulatif, remise sous chaque ligne
  concernée, remise et frais de commande dans les totaux ; suivi de commande : total des
  promotions et des frais. Textes dans `packages/i18n`.
- Back-office : remises sous la ligne, détail du total (sous-total, frais, cadeau, promotions,
  code promo).

### Étapes imbriquées sur trois niveaux

- `MAX_NESTING_DEPTH` = 3 (`packages/core`) : une étape d'option `a` (options `a>b`), une étape de
  `a>b` (`a>b>c`), une étape de `a>b>c` (`a>b>c>d`) ; une étape plus profonde est ignorée à la
  traduction. Identifiants inchangés dans leur principe (préfixe du parent complet).
- Calcul serveur : une étape n'est active (donc exigée) que si son option parente est choisie
  dans un groupe lui-même actif ; un choix dont un ancêtre manque est refusé (`unknown_option`).
- Envoi : à plat dans `ingredients`, `ingredient` = `ingid` = option, `parentid` = ingrédient
  parent **direct** ; prix unitaire avec `qte` > 1 (confirmé le 26/11).
- Application : retrait de 16 points par niveau ; décocher une option vide les choix de toutes
  ses étapes descendantes.

## Hypothèses à confirmer (questions en attente n° 23)

1. Prix d'un article pour la remise et le classement « le moins cher » : options comprises.
2. Lot incomplet quand `min` < `max` (2/3 avec deux articles) : le 2e est remisé (rang atteint).
3. Plusieurs lots en `all` : les N articles les moins chers de tout le panier (pas « le moins
   cher de chaque lot »).
4. Arrondi d'un pourcentage au centime le plus proche (caisse).
5. `origin` du cadeau fidélité (« loyalty ») et format de sa remise d'article ; un article offert
   par le cadeau n'est pas compté dans les lots.
6. Frais de règle : `valeur` de la règle et `taux` reçu repris tels quels.

## Conséquences

- Le prix payé en ligne suit la caisse : l'écart à rembourser au back-office disparaît pour les
  promotions de catalogue (sauf hypothèse démentie ci-dessus).
- Une ancienne version de l'application ne voit pas le badge ni le détail des remises, mais paie
  le bon total (calcul serveur, champs nouveaux à valeur par défaut).
- Une règle changée en caisse s'applique au prochain rafraîchissement de la carte (cache ou
  webhook « catalogue », ADR 0029).
