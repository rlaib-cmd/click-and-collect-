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
  `jour_comptable` : une vente avant 02:00 (Paris) appartient à la veille ; pagination annoncée à partir de 1 mais constatée à partir de 0 (`page=1` = deuxième page).

## Correspondance avec notre application

| Splash360 | Chez nous | Remarque |
|---|---|---|
| `categories` → `groupes` → `produits` | catégories / produits de `Menu` (`packages/core`) | Deux niveaux côté Splash360 (catégorie puis groupe) ; `groupes_alt` = produit dans plusieurs groupes |
| `produits[].prix_c`, `prixArray_c[]` | prix TTC en centimes | `prixArray_c` a 3 à 5 entrées : correspondance entrée ↔ mode (sur place / à emporter / livraison) à confirmer |
| `ingredients[]` (`supplement_c`, `asproduct`) | options | Lien produit ↔ ingrédients via `composition` / `compo` (non typés) |
| `steps[]` + `regles[]` | groupes d'options (min / max) | Format de `regle` non documenté |
| `active`, `visible` | disponible / masqué | Valeurs entières, sens à confirmer |
| `image.location` | photo | URL absolue ou relative à confirmer |
| `mode` : `emporter` / `livraison` / `surplace` | `pickup` / `delivery` / — | |
| `total` (nombre, euros) | `total_cents` | Conversion centimes → euros au dernier moment, arrondi exact |
| `modificateurs` `discount` | code promo, cadeau fidélité | `valeur` en chaîne « 3.50€ » ou « 10% » |
| `modificateurs` `frais` (+ `taux` TVA) | frais de livraison / de service | |
| `orderNumber` | numéro de commande en ligne | Sert aussi de clé d'idempotence, si Splash360 la respecte |
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
