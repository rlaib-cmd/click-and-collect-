# ADR 0024 — Splash360 v2 : jeton api2, appels séquentiels par identifiant client, options par étapes

Date : 2026-11-25 · Statut : acceptée

## Contexte

Consignes de Splash360 (CTO, 25/11) pour le pilote (organisation 130, restaurant 164 = Chicken Street Siège) :

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
- Non traduit, en attente de Splash360 (`docs/questions-en-attente.md`, n° 18) :
  `reglescatalogue` (promotions), `gifts`, `compo`/`composition`. `max_par_produit`, étapes
  imbriquées et `prixArray_c` sont traduits depuis le 26/11 (ci-dessous).
- La vérification des tickets ambassadeur par l'export des ventes attend un exemple réel de réponse.

## Réponses du 26/11 (directeur technique de Splash360)

Réponses faisant foi (détail dans `docs/api-splash360/analyse-api-click-collect.md`). Décisions :

1. **Prix par mode** : `prixArray_c` (et `supplementArray_c`) = [sur place, à emporter, livraison,
   Uber, Deliveroo]. La carte interne porte `modePrices` (`pickup` = entrée 1, `delivery` =
   entrée 2, `prix_c` / `supplement_c` à défaut) ; `menuForMode` (`packages/core`) choisit le prix
   du mode. Le serveur calcule le panier au prix du mode de la commande ; la carte publique se lit
   avec `?mode=pickup|delivery` (à emporter par défaut) et l'application la demande pour le mode
   choisi : le prix affiché est celui qui sera payé. Une ancienne version de l'application voit les
   prix à emporter ; le devis, recalculé par le serveur, donne le vrai total.
2. **Même option deux fois** (`max_par_produit`) : `maxPerOption` sur le groupe ; l'option est
   répétée dans `optionIds` (contrat inchangé, 60 identifiants au plus) et dans `order_item_options`
   (une ligne par unité, sans migration) ; prix × quantité. La caisse la reçoit une fois avec
   `qte` (prix unitaire dans `price`). Application : compteur − / + par option.
3. **Étapes imbriquées** (`steps[].produit` = ingrédient) : groupe d'options rattaché à l'option
   parente (`parentOptionId`), identifiants `parent>option` pour rester uniques dans le produit et
   retrouver le parent sans migration. Exigé seulement si l'option parente est choisie ; une option
   qui ouvre une étape ne se prend qu'une fois. Envoi à plat : `ingredient` = `ingid` = option,
   `parentid` = ingrédient parent. Un seul niveau d'imbrication.
4. **Heure** : `scheduledAt` (ISO 8601, décalage de Paris, millisecondes) seulement quand le client
   a choisi une heure ; « dès que possible » n'envoie rien (l'heure estimée reste en commentaire).
5. **Frais** : modificateur au format exact donné (`modificateur_id`, `valeur` « 1.00€ »,
   `taux` 0,2, `item`/`ingredient` nuls, `nom` « Frais », `operation` 1). Les remises gardent leur
   format (`type`, `valeur`, `nom`), aucun format n'ayant été donné pour elles.
6. **Pas d'idempotence chez Splash360** (un second `submitcommande` crée une seconde commande) :
   le dépôt est réservé une seule fois par commande (`orders.pos_opening_at`). Réservation déjà
   prise depuis plus de 30 s sans ticket enregistré = dépôt **incertain** : jamais refait
   automatiquement (ni par la poignée de main, ni par les nouveaux essais de l'envoi) ; avant
   paiement la commande est annulée, après paiement l'envoi passe en alerte « vérifiez en caisse ».
   Seul « Renvoyer à la caisse » au back-office libère la réservation, après vérification.
7. **Annulation d'une commande `standby`** : seulement en caisse. On ne dépose en caisse qu'au
   moment du paiement (ADR 0018) ; quand nous abandonnons une commande déposée (paiement non
   terminé, caisse pas prête, dépôt incertain), elle est journalisée et le back-office affiche
   « annulez-la directement en caisse » (24 h, `GET /v1/admin/alerts` → `posToCancel`).
8. **Statuts après `confirmed`** : la caisse n'en renvoie aucun ; le suivi reste celui du
   back-office.
9. **Non construit** : webhook de rupture de stock (adresse d'inscription, contenu et signature
   inconnus) et promotions de catalogue `reglescatalogue` (forme insuffisante, voir l'analyse).
   Conséquence connue : si la caisse applique une promotion de catalogue à la réception, le total
   en caisse peut être inférieur au montant payé en ligne ; l'équipe rembourse l'écart au
   back-office tant que la règle n'est pas appliquée en ligne.
10. Hypothèses à confirmer : `price` d'un ingrédient avec `qte` > 1 = prix **unitaire** (comme
    `price` d'une ligne) ; `ingredient` envoyé en plus de `ingid` pour une option imbriquée ;
    format des remises inchangé.

## Réponses du 26/11, suite (lot 24, ADR 0030)

Le directeur technique de Splash360 a donné, d'après le code de la caisse (`release/version-1.4.x`),
le sens des promotions de catalogue et confirmé les hypothèses d'envoi du point 10 :

- `reglescatalogue` est désormais traduit et appliqué en ligne comme en caisse (ADR 0030) : la
  conséquence du point 9 (écart à rembourser) ne vaut plus pour les promotions de catalogue.
- `price` d'un ingrédient avec `qte` > 1 = prix unitaire : **confirmé**. `ingredient` envoyé avec
  `ingid` : **confirmé**.
- Remises : format de la borne (`setCommandeFromAPI`) — remise d'article dans
  `items[].modificateurs` (pourcentage, `itemOnly`), remise de commande en « 10% » ou « 5€ » ;
  le cadeau fidélité part en remise d'article (ADR 0030).
- Étapes imbriquées : la caisse en gère **trois niveaux** ; nous aussi depuis le lot 24
  (`MAX_NESTING_DEPTH`), `parentid` = ingrédient parent direct.
- Webhook de rupture depuis le gestionnaire de stock : route en conception chez Splash360, sans
  effet sur le click and collect (les ruptures de la caisse arrivent déjà par webhook, ADR 0029).

