# ADR 0024 — Splash360 v2 : jeton api2, appels séquentiels par identifiant client, options par étapes

Date : 2026-11-25 · Statut : acceptée

## Contexte

Consignes de Splash360 (CTO, 25/11) pour le pilote (organisation 130, restaurant 164) :

- jeton OAuth2 `client_credentials` sur `https://api2.splash360.fr/oauth/v2/token`, identifiants en
  `Authorization: Basic base64(client_id:client_secret)`, corps `grant_type=client_credentials&scope=user`,
  jeton valable 24 h ; les identifiants actuels sont les bons pour api2 ;
- carte v2 : `GET https://api.splash360.fr/api/export/v2/menus` ; `categories` = catalogues de la
  caisse, `groupes` = catégories, `types` = personnalisations, `ingredients` rattachés à leur type,
  `steps` = règles ordonnées par produit (`regles` : type, min, max, `max_par_produit`, supplément) ;
- export des ventes : `GET https://api2.splash360.fr/api/export/orders?page&pageSize(≤100)&fromDate&toDate&status`,
  même jeton ; **au plus un appel par minute et par identifiant client** ;
- **appels séquentiels par identifiant client** : jamais deux appels en parallèle ;
- pas encore de ruptures de stock côté Splash360.

Le serveur tourne en plusieurs exemplaires (copies de la fonction Edge, ou plusieurs conteneurs).
Une file en mémoire ne sérialise que les appels d'un même exemplaire.

## Décision

1. **Client unique** (`packages/api-menu/src/splash360/client.ts`, règle n° 5) : URL du jeton
   (`SPLASH360_TOKEN_URL`, défaut api2), portée (`SPLASH360_SCOPE`, défaut `user`), chemin de la carte
   (`SPLASH360_MENU_PATH`, défaut `/api/export/v2/menus`) paramétrables ; jeton gardé jusqu'à 60 s
   avant `expires_in` (24 h si absent), redemandé une fois sur 401.
2. **Une file par identifiant client** dans chaque exemplaire : jeton, carte, caisse et ventes du même
   identifiant passent l'un après l'autre (la réponse est lue avant l'appel suivant).
3. **Exclusivité entre exemplaires** : chaque échange s'exécute dans une transaction courte qui prend
   `pg_advisory_xact_lock(hashtextextended('splash360:' || empreinte, 0))` puis fait l'appel HTTP
   (`createPostgresSplash360Gate`, `packages/db`). Le verrou de **transaction** est libéré au commit :
   il fonctionne avec le pooler Supavisor en mode transaction, contrairement à `pg_advisory_lock`
   (verrou de session, qui resterait sur une connexion serveur partagée). Garde-fous : délai HTTP de
   10 s, `lock_timeout` de 30 s, file locale en amont (un exemplaire n'attend le verrou qu'avec un
   seul échange à la fois par identifiant).
4. **Export des ventes : une minute entre deux appels**, garanti entre exemplaires par la table
   `splash360_private.call_slots (client_key, last_sales_call_at)` : `insert … on conflict do update
   … where last_sales_call_at <= now() - 1 min returning` (la ligne est verrouillée par la mise à
   jour, deux exemplaires ne passent pas ensemble). Sinon le client renvoie une erreur 429 avec
   l'attente (`retryAfterMs`) ; la route de diagnostic la traduit en `Retry-After`. Sans base (tests,
   outils), la pause vaut pour l'exemplaire seulement.
5. **Clé = empreinte SHA-256 de `splash360:<client_id>`** : ni l'identifiant en clair ni le secret
   ne sont stockés ou journalisés.
6. **Identifiants de l'export des ventes** : les principaux par défaut ; surcharge facultative
   `SPLASH360_ORDERS_CLIENT_ID` / `SPLASH360_ORDERS_CLIENT_SECRET` (prise en compte seulement si les
   deux sont posés) et `SPLASH360_ORDERS_API_URL` (défaut api2). Chaque identifiant a sa file, son
   jeton et son verrou.
7. **Options et formules** (`toMenu`) : pour chaque produit, chaque règle de son étape devient un
   groupe d'options dans l'ordre des règles ; options = ingrédients visibles du type, identifiant =
   `ingredient_id` complet (envoyé tel quel à `submitcommande`), prix = `supplement_c` (+ supplément de
   la règle s'il est positif) ; min/max bornés au nombre d'options ; ingrédient `active: 0` →
   option indisponible ; produit indisponible si un groupe obligatoire n'a plus assez d'options.
   Libellé affiché = `legende` (texte client), sinon `nom` (libellé du ticket de caisse, p. ex.
   « ###   S   ### » pour « Sauce Sucrée »). Le prix reste calculé par le serveur (`packages/core`).
8. **Routes de diagnostic super-administrateur** : `GET /v1/admin/restaurants/:id/splash360/menu-raw`
   (carte brute v2) et `…/sales-raw?date=AAAA-MM-JJ` (5 ventes au plus, `confirmed,deleted`), sans
   cache, tracées au journal d'audit.

### Exception à la règle « `tenant_id` sur toute table »

`call_slots` ne porte pas de `tenant_id` : l'identifiant client Splash360 est une donnée de la
plateforme, partagée entre enseignes, et la contrainte de Splash360 est par identifiant client. La
table vit hors du schéma `public` (`splash360_private`, non exposé par l'API REST de Supabase), RLS
activée sans règle, droits retirés à `anon` et `authenticated` ; test pgTAP dédié.

## Conséquences

- Un échange Splash360 occupe une connexion Postgres pendant l'appel HTTP (10 s au plus). La fonction
  Edge n'ouvre que 2 connexions par copie : la file locale limite à une connexion par identifiant
  client et par copie. Si Splash360 répond lentement, les autres copies attendent le verrou (30 s au
  plus) puis échouent proprement (carte servie depuis le cache, commande réessayée par le suivi).
- Si la base est indisponible, les appels Splash360 échouent aussi : choix assumé, puisque la commande
  ne peut de toute façon pas être enregistrée.
- Non traduit, en attente de Splash360 (`docs/questions-en-attente.md`, n° 18) : `max_par_produit` > 1
  (quantité par option), étapes imbriquées (étape d'un ingrédient choisi dans une formule),
  `prixArray_c` (prix par mode), `reglescatalogue` (promotions), `gifts`, `compo`/`composition`.
- La vérification des tickets ambassadeur par l'export des ventes attend un exemple réel de réponse.
