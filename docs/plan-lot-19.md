# Lot 19 — Splash360 v2 : connexion, appels séquentiels, options et formules

**Demande** (25 novembre, e-mail du CTO de Splash360) : jeton sur api2 (Basic + `scope=user`),
carte v2 (`/api/export/v2/menus`) avec personnalisations et étapes, appels **séquentiels par
identifiant client**, une minute entre deux collectes des ventes. Pilote : organisation 130,
restaurant 164. Décisions : ADR 0024.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Client Splash360 : URL du jeton, portée et chemin de la carte paramétrables (`SPLASH360_TOKEN_URL`, `SPLASH360_SCOPE`, `SPLASH360_MENU_PATH`), identifiants en Basic, jeton gardé jusqu'à 60 s avant expiration |
| 2 | File par identifiant client + verrou consultatif Postgres de transaction entre exemplaires (`createPostgresSplash360Gate`) ; panne du verrou = erreur réessayable |
| 3 | Export des ventes : `listSales({ fromDate, toDate, status, page, pageSize })` sur api2, une minute entre deux appels par identifiant client garantie en base (`splash360_private.call_slots`, empreinte SHA-256 seulement), identifiants dédiés facultatifs `SPLASH360_ORDERS_*` |
| 4 | Carte v2 : étapes → groupes d'options (ordre, min/max, suppléments, ingrédients inactifs), libellé client `legende`, produit indisponible si un choix obligatoire n'a plus d'option ; copies du catalogue DELIVERY non dupliquées |
| 5 | Caisse : options envoyées avec l'`ingredient_id` complet ; prix toujours recalculés par le serveur |
| 6 | Application : la fiche produit affichait déjà les choix (un seul choix = boutons radio, sinon cases à cocher, « 1 au choix », « entre 1 et 3 », « jusqu'à 5 ») |
| 7 | Diagnostic super-administrateur : `GET /v1/admin/restaurants/:id/splash360/menu-raw` et `…/sales-raw?date=AAAA-MM-JJ` (5 ventes au plus, 429 + `Retry-After` dans la minute) |

## Vérifications

- Tests : traduction v2 sur deux extraits réels (Chicken Street, `fixture-v2.ts` ; Tasty Crousty,
  `fixture-tasty-v2.ts`), jeton Basic + portée, file séquentielle (jamais deux requêtes simultanées),
  verrou global (clé hachée), pause d'une minute, filtre des ventes, routes de diagnostic.
- Postgres : `splash360-gate.integration.test.ts` (deux réservations simultanées → une seule passe,
  tâches exclusives) et pgTAP `splash360_call_slots_test.sql`.
- Recette : migration `20261125090000_splash360_call_slots.sql` appliquée ; carte Chicken Street Siège
  v2 lue par l'API publique (12 catégories, 159 produits, 93 avec options). **Aucune commande** passée
  sur Chicken Street (vraie caisse).

## Cartes réelles analysées

| Carte | Catégories | Produits affichés | Avec options | Indisponibles |
|---|---|---|---|---|
| Chicken Street Siège (route menu-raw, 25/11) | 12 | 159 | 93 | 0 |
| Tasty Crousty (exemple fourni par Splash360) | 9 | 78 | 16 | 18 (`active: 0`) |

## Ce qui reste

1. Récupérer **un** exemple réel de l'export des ventes (`sales-raw`, `pageSize` 5) puis, une fois le
   format connu, vérifier les tickets ambassadeur à partir des ventes (non codé : format inconnu).
2. Réponses de Splash360 (questions-en-attente, n° 18) : quantités `max_par_produit` > 1, étapes
   imbriquées des formules, prix par mode, promotions, ruptures de stock.
3. Production : migration `20261125090000_splash360_call_slots.sql`, puis fonction `api` ; secrets
   facultatifs seulement si les défauts ne conviennent pas.
