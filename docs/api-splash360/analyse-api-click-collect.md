# API Click & Collect Splash360 — analyse (v1.0.0)

Source : SwaggerHub `SPLASH360/splash-click-collect-api/1.0.0`, copie dans `openapi-click-collect-1.0.0.json` (données personnelles de l'exemple remplacées par des valeurs fictives).
Serveur : `https://api.splash360.fr`. Authentification : OAuth2 *client credentials* (`POST /oauth/v2/token`), puis `Authorization: Bearer <jeton>`.

## Parcours indiqué par le CTO de Splash360

1. `GET /api/export/menus` — récupérer la carte.
2. Ingestion de la carte (chez nous : `packages/api-menu`).
3. `POST /api/import/submitcommande` — soumettre la commande (statut `standby`) → `ticketId`.
4. `GET /api/export/cmdstatus/{ticketId}` — interroger régulièrement jusqu'au statut `ready`.
5. `POST /api/import/submitcmdpaiement/{ticketId}` — notifier le paiement (`reglements`).
6. La commande arrive en caisse.

## Mise en œuvre (lot 14, ADR 0018)

- Client unique : `packages/api-menu/src/splash360/client.ts` (OAuth2, jeton en cache) ; carte :
  `menu.ts` ; lecture des statuts : `status.ts` ; caisse : `apps/api/src/pos/splash360.ts`.
- Parcours confirmé par le CTO (message vocal du 23/11) : la caisse doit répondre « ready » **avant**
  le paiement, puis « confirmed » après l'envoi du paiement ; sinon annulation ou remboursement
  automatique.
- Accès vérifié le 24/11 : `GET /api/export/menus` sans jeton → 401 « OAuth2 authentication
  required » ; `/oauth/v2/token` attend `grant_type=client_credentials`.

## Consignes v2 (CTO, 25/11 — lot 19, ADR 0024)

- Jeton : `POST https://api2.splash360.fr/oauth/v2/token`, `Authorization: Basic base64(id:secret)`,
  `grant_type=client_credentials&scope=user`, 24 h. Vérifié en recette le 25/11 (HTTP 200).
- Carte v2 : `GET /api/export/v2/menus` (`types`, `ingredients`, `steps`/`regles`) ; traduite en
  groupes d'options par `toMenu`. Libellé client = `legende`, libellé du ticket = `nom`.
- Ventes : `GET https://api2.splash360.fr/api/export/orders?page&pageSize(≤100)&fromDate&toDate&status`
  (`confirmed` par défaut, `deleted`, ou les deux) ; format relevé le 25/11 (ci-dessous).
- Appels séquentiels par identifiant client ; une minute entre deux collectes des ventes.

## Format de l'export des ventes (relevé le 25/11, Chicken Street Siège, journée du 24/11)

Lecture unique par le diagnostic super-admin ; seule la structure est conservée (aucune donnée de vente
ni de client copiée).

- Enveloppe : `{ data: Vente[], pagination: { page, pageSize, total, totalPages, hasNextPage } }`.
- `Vente` : `ticket_id` (UUID), `local_id` (UUID), `numero`, `chrono`, `restaurant_id`, `jour_comptable`
  (AAAA-MM-JJ), `mode` (`surplace` / `emporter` / `livraison`), `status` (`confirmed` / `deleted`),
  `commande_type` (ex. `vente`), `pos_type` (ex. `caisse`), `centre_revenu`, `devise` (`EUR;€`),
  `total` (euros, nombre à virgule), `prix_ttc` / `prix_ht` / `montant_tva` / `total_remises` (entiers,
  vraisemblablement en centimes), `tva[]` (`code`, `nom`, `valeur`, `montant`, `ht`, `ttc`),
  `items[]`, `reglements[]` (`moyen` : `carte`, `especes`… ; `valeur` en euros ; `detail` ;
  `reglementId`), `modificateurs[]`, `comments[]`, `rendus[]`, `client`, `customer_id`, `bipper`,
  `wait_time`, horodatages ISO avec fuseau (`createdAt`, `updatedAt`, `syncedAt`, `order_start`,
  `order_end`, `production_*`, `shipping_*`).
- `items[]` : `itemid` (UUID), `nom`, `produitid`, `plu`, `produit_fk`, `quantite`,
  `prix_unitaire_ttc`, `prix_ttc`, `prix_ht`, `montant_tva` (entiers), `ingredients[]`.
- À confirmer avec Splash360 : unité des montants entiers (centimes ?).
- Réponses de Splash360 (25/11, ADR 0025) : le `ticket_id` est imprimé en texte sur le ticket de
  caisse (UUID seul sur sa ligne, sous le « #numéro ») et encodé dans le QR des tickets de borne ;
  `jour_comptable` : une vente avant 02:00 (Paris) appartient à la veille ; pagination annoncée à partir de 1 mais constatée à partir de 0 (`page=1` = deuxième page) ; **confirmé le 26/11 : elle reste à 0**.

## Correspondance avec notre application

| Splash360 | Chez nous | Remarque |
|---|---|---|
| `categories` → `groupes` → `produits` | catégories / produits de `Menu` (`packages/core`) | Deux niveaux côté Splash360 (catégorie puis groupe) ; `groupes_alt` = produit dans plusieurs groupes |
| `produits[].prix_c`, `prixArray_c[]` | prix TTC en centimes, par mode | Ordre (26/11) : sur place, à emporter, livraison, Uber, Deliveroo. À emporter = entrée 1, livraison = entrée 2 (`ttc`) ; `prix_c` si le tableau manque ou est trop court. Idem `supplementArray_c` des ingrédients |
| `ingredients[]` (`supplement_c`, `asproduct`) | options | Lien produit ↔ ingrédients via `composition` / `compo` (non typés) |
| `steps[]` + `regles[]` | groupes d'options (min / max, `max_par_produit`) | Étape d'un ingrédient (`steps[].produit` = « ing…-typ… ») : étape imbriquée, groupe rattaché à l'option parente |
| `active`, `visible` | disponible / masqué | Valeurs entières, sens à confirmer |
| `image.location` | photo | URL absolue ou relative à confirmer |
| `mode` : `emporter` / `livraison` / `surplace` | `pickup` / `delivery` / — | |
| `total` (nombre, euros) | `total_cents` | Conversion centimes → euros au dernier moment, arrondi exact |
| `modificateurs` `discount` | code promo, cadeau fidélité | `valeur` en chaîne « 3.50€ » ou « 10% » |
| `modificateurs` `frais` (+ `taux` TVA) | frais de livraison / de service | Format exact (26/11) : `{ modificateur_id, type: 'frais', valeur: '1.00€', taux: 0.2, item: null, ingredient: null, nom: 'Frais', operation: 1 }` |
| `orderNumber` | numéro de commande en ligne | **Pas** de clé d'idempotence (26/11) : un second envoi crée une seconde commande ; l'unicité est garantie de notre côté |
| `paymentType` | paiement sur place | `carte`, `especes`… pour les paiements à la remise |
| `submitcmdpaiement` `reglements[{type:'carte', valeur, detail}]` | paiement Stripe confirmé par webhook | `detail` = identifiant du paiement Stripe |

Règle maintenue : le paiement n'est notifié à Splash360 qu'après le webhook Stripe vérifié, et les montants envoyés viennent du calcul serveur (`packages/core`).

## Questions à poser à Splash360

1. **Un identifiant client par restaurant ?** `GET /menus` n'a aucun paramètre de restaurant : le restaurant est-il déduit du `client_id` ? Comment gérer une enseigne à plusieurs restaurants ?
2. **Environnement de test** : existe-t-il une caisse de recette ? Une commande envoyée avec ces accès arrive-t-elle dans une vraie caisse de restaurant ?
3. **Statuts** : liste complète des valeurs renvoyées par `cmdstatus` (`standby`, `ready`, puis ?). La doc ne décrit que `success`. Quel délai pour passer à `ready` ? Fréquence d'interrogation conseillée ?
4. **Heure de retrait** : aucun champ pour le créneau choisi par le client. Où le transmettre (commentaire ?) ?
5. **Annulation** : comment annuler une commande `standby` jamais payée (paiement abandonné ou refusé) ?
6. **`prixArray_c`** : quelle entrée correspond à quel mode ?
7. **Composition** : faut-il envoyer tous les ingrédients de base (comme dans l'exemple) ou seulement les suppléments ? Comment signaler un ingrédient retiré ?
8. **`steps` / `regles`** : format des règles (min, max, obligatoire) ?
9. **Idempotence** : un second `submitcommande` avec le même `orderNumber` crée-t-il une deuxième commande ?
10. **Statuts après la caisse** (en préparation, prête, remise) : sont-ils disponibles, par interrogation ou par webhook ?
11. **Fidélité** : cette API n'expose pas la fidélité (solde, paliers, débit de points). Une autre API existe-t-elle ?
12. **Jeton** : durée de vie, limites de débit, quota.
13. **`comments`** : tableau de tableaux (`array<array<…>>`) — voulu ?
14. **Changement de carte** : un moyen de savoir que la carte a changé (révision, webhook), ou faut-il la relire régulièrement ?

## Réponses du 26/11 (directeur technique de Splash360)

Réponses faisant foi ; ce qui est appliqué est décrit dans l'ADR 0024 (« Réponses du 26/11 »).

| # | Sujet | Réponse | Appliqué |
|---|---|---|---|
| 8 | Identifiant d'ingrédient de `submitcommande` | Identifiant complet (`ing15407-typ2075`) | Déjà le cas ; test ajouté |
| 9 | Même option choisie deux fois (`max_par_produit` = 2) | Envoyée une fois avec `qte: 2` | Option répétée dans le panier (core, contrats, application : compteur), regroupée en `qte` à l'envoi, prix unitaire dans `price` |
| 10 | Étapes imbriquées d'une formule (`steps[].produit` = « ing…-typ… ») | À plat dans `ingredients`, avec `ingid` et `parentid` (ingrédient parent) ; la caisse gère trois niveaux | Groupe imbriqué rattaché à l'option parente (`parentOptionId`) ; option envoyée avec `ingredient` = `ingid` et `parentid` (parent direct). Trois niveaux depuis le lot 24 (ADR 0030) |
| 11 | Ordre de `prixArray_c` | sur place, à emporter, livraison, Uber, Deliveroo | Prix à emporter (entrée 1) ou livraison (entrée 2), produits et suppléments ; `prix_c` à défaut. Carte servie au prix du mode (`?mode=`), calcul serveur au prix du mode |
| 12 | Statuts après `confirmed` | Aucun : la caisse ne renvoie plus rien | Suivi inchangé : l'équipe fait avancer la commande au back-office |
| 13 | Annuler une commande `standby` | Seulement depuis la caisse | Jamais de dépôt laissé sans besoin ; une commande annulée chez nous (paiement non terminé, caisse pas prête, dépôt incertain) est signalée au back-office : « annulez-la directement en caisse » |
| 14 | Second `submitcommande` avec le même `orderNumber` | Crée une seconde commande | Dépôt réservé une seule fois (`pos_opening_at`) ; un dépôt commencé sans ticket n'est jamais refait automatiquement, seulement par « Renvoyer à la caisse » après vérification |
| 15 | Heure de retrait | `scheduledAt` à la racine, ISO 8601 avec le décalage de Paris (`2026-11-26T14:22:22.177+01:00`) | Envoyé seulement si le client a choisi une heure ; « dès que possible » : rien (heure estimée en commentaire). Le commentaire est gardé |
| 16 | Frais | TVA 20 % dans `modificateurs`, format exact ci-dessus | `nom: 'Frais'` ; `modificateur_id` = `frais_livraison` ou `frais_service` |
| 17 | Ruptures de stock | Un webhook existe | Non construit : URL d'inscription, contenu et signature inconnus (questions en attente) |
| 18 | Promotions de catalogue (`reglescatalogue`) | Appliquées par la caisse à la réception : à appliquer aussi en ligne ; règles données le 26/11 (ci-dessous) | Appliquées en ligne comme en caisse depuis le lot 24 (ADR 0030) |
| 19 | Pagination de l'export des ventes | Reste à 0 | Inchangé (première page = 0) |

### `reglescatalogue` : règles de la caisse (réponse du 26/11)

Exemple réel (carte Chicken Street Siège du 25/11) :

```json
{ "reglecatalogue_id": "modifier4_emporter", "type": "catalogue", "mode": "emporter",
  "start": 1780963200000, "end": 4936723199000, "min": 4, "max": 4, "quantite": 0,
  "produits": ["prd15178", "prd15177", "prd15176", "prd15170", "prd15169"],
  "selection": "all", "valeur": "100%", "operation": -1, "nom": "3 acheter = 1", "taux": 0 }
```

Réponse du directeur technique de Splash360 (26/11), relevée dans le code de la caisse
(`release/version-1.4.x`), transcrite fidèlement :

**Sens des champs**

- `produits` : produits concernés. Liste vide = la règle s'applique à toute la commande.
- `min` / `max` : les articles sont comptés par lots de `max` ; dans chaque lot, les articles de
  rang `min` à `max` sont remisés. Exemples : 4/4 = le 4e offert, 3/3 = le 3e offert, 2/3 = le 2e
  et le 3e remisés, 0/0 = chaque article remisé. Si `min` > 0 et `max` = 0, la règle est ignorée.
- `quantite` : nombre maximal d'articles remisés par commande ; 0 = sans limite.
- `selection` : « one » = chaque produit compté séparément (4 Coca comptent, 2 Coca + 2 Fanta
  non) ; sinon (« all ») : tous les produits de la liste comptés ensemble.
- `valeur` : « 100% » ou « 3.9€ » (point décimal).
- `operation` : -1 = remise ; +1 = frais ajoutés (seulement pour une règle sans produits).
- `mode` : « surplace », « emporter », « livraison » ou « all ». Le back-office envoie une copie
  de chaque règle par mode (identifiants `…_surplace`, `…_emporter`, `…_livraison`) : ne garder
  que les copies du mode de la commande, plus « all ».
- `start` / `end` : dates en millisecondes ; `end` = 0 = sans date de fin.

**Article remisé** : en « all », les moins chers parmi tous les articles concernés (panier 10, 10,
6, 4 € avec « le 4e offert » → l'article à 4 €) ; en « one », calcul produit par produit, remise
sur la ligne de ce produit.

**Répétition** : à chaque lot complet (4e offert : 8 articles → 2 offerts, 7 → 1) ; `quantite`
plafonne par commande.

**Cumul** : deux remises sur le même article : non — une seule remise par ligne, la première de
la liste ; une remise existante (coupon, borne) est prioritaire sur les règles. Remise d'article
et remise de commande : oui ; la remise de commande se calcule sur le total déjà remisé (4e offert
puis 10 % sur 40 € → 40 − 10 − 3 = 27 €). Deux remises de commande (règle + coupon, ou deux
règles) : non — seule la première compte.

**Envoi dans `submitcommande`** : même format que la borne (`setCommandeFromAPI`) :

- remise d'article : dans `items[].modificateurs`, une entrée par article remisé :
  `{ "type": "discount", "origin": "bogo", "nom": "<nom exact de la règle>", "operation": -1,
  "valeur": "100%", "itemOnly": true }`. La caisse découpe la ligne pour que seul l'article remisé
  la porte. La valeur doit être un **pourcentage** (un montant en euros sur un article est mal lu) ;
- remise de commande : dans les `modificateurs` de la commande, « 10% » ou « 5€ » ;
- `nom` doit être exactement le nom de la règle : la caisse remplace au lieu d'ajouter.

Autres réponses du même jour : `price` d'un ingrédient avec `qte` > 1 = prix unitaire (confirmé) ;
`ingredient` + `ingid` pour une option imbriquée (confirmé) ; la caisse gère trois niveaux
d'étapes imbriquées ; la route de rupture depuis le gestionnaire de stock est en conception chez
Splash360 (sans effet pour le click and collect).

Application chez nous et hypothèses retenues : ADR 0030 ; hypothèses à confirmer : questions en
attente n° 23.
