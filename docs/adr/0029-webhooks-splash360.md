# ADR 0029 — Webhooks Splash360 : disponibilité, prix de livraison, catalogue, encaissement

- Statut : acceptée (26 novembre 2026)
- Liens : guide Splash360 transcrit dans `docs/api-splash360/webhooks.md` ; ADR 0010 (paiement sur
  place), ADR 0018 (caisse avant paiement), ADR 0024 (Splash360 v2, schéma privé), plan
  `docs/plan-lot-23.md`.

## Contexte

Splash360 envoie quatre événements par station click and collect : disponibilité des articles,
prix de livraison propres, mise à jour du catalogue, encaissement ou annulation d'une commande.
Chaque appel est signé (Standard Webhooks), doit recevoir un 2xx en moins de 10 s, peut être
retenté (même `webhook-id`) pendant 24 h et peut arriver dans le désordre. Jusqu'ici la carte
n'était relue que par le cache (3 min) et la caisse ne nous disait rien après `confirmed`.

## Décisions

### Réception

- Quatre URL, une par événement : `POST /v1/webhooks/splash360/<stock|prices|catalog|orders>/<station>`.
  Le dernier segment est l'identifiant client de la station (décodé par Hono).
- **Signature** (`packages/api-menu/src/splash360/webhooks.ts`) vérifiée sur les **octets reçus**
  (`c.req.arrayBuffer()`), avant tout décodage JSON : clé = base64 après `whsec_`, HMAC-SHA256 de
  `id.timestamp.corps`, comparaison en temps constant des textes base64 à chaque valeur `v1,…`,
  horodatage à ± 300 s (horloge injectée). Le vecteur de test du guide passe en test unitaire.
  Refus : `401` sans corps ni motif. Aucun secret posé : `503`.
- **Secrets** : `SPLASH360_WEBHOOK_SECRETS`, liste séparée par des virgules (un par URL si
  Splash360 en donne plusieurs, plus l'ancien pendant une bascule de 24 h) ; une signature valide
  pour l'un d'eux suffit. Lus au démarrage ; un secret illisible arrête le démarrage avec son
  rang, jamais sa valeur. Jamais journalisés.
- **Challenge** (objet avec la clé `challenge`) : renvoyé tel quel après vérification de la
  signature ; rien n'est enregistré.
- **Réponse immédiate** : l'appel est enregistré (dédoublonnage), puis traité en tâche de fond
  (`EdgeRuntime.waitUntil` sur Supabase Edge via `background`, promesse détachée sur le serveur
  Node). Jamais de `410` (il désactiverait l'URL chez Splash360).
- **Station inconnue** : `2xx` quand même (pour que Splash360 ne désactive pas l'URL après
  20 échecs), journal du serveur avec les **4 premiers caractères** seulement, et ligne
  « Station inconnue » dans le journal « Webhooks reçus » du back-office, où le super-administrateur
  lit l'identifiant complet pour le rattacher.
- Corps signé mais illisible pour l'événement : `2xx`, noté « Échec » (une nouvelle tentative
  ne le rendrait pas lisible). JSON invalide : `400`.
- Limitation de débit large (1 200/min par adresse), pas de CORS utile (appel serveur à serveur).

### Station → restaurant

Colonne `restaurants.splash360_station_id` (nullable, unique, format `[A-Za-z0-9_.-]{1,100}`),
réglée par le super-administrateur dans le back-office (page Paiement, section Caisse Splash360,
journalisée `splash360.station`). Pas de valeur par défaut dans l'environnement.

### Dédoublonnage et journal

Table `splash360_private.webhook_receipts` (schéma privé du lot 19) : `webhook_id` en clé
primaire, événement, station, enseigne et restaurant (nuls pour une station inconnue : exception
assumée à « tenant_id non nul », comme `call_slots`), résultat et résumé **sans donnée
personnelle** (compteurs, statut, effet). Un `webhook-id` déjà reçu n'est jamais retraité.
Conservation **7 jours** (au moins 48 h exigées), purge horaire (serveur Node, fonction Edge au fil
du trafic). Le back-office (super-administrateur) affiche les 100 derniers.

### États de la caisse et carte

- Table `menu_stock_overrides` (`tenant_id`, `restaurant_id`, `item_id`, `available`,
  `delivery_price_cents`, `updated_at`, `source_webhook_id` ; RLS sans politique). Chaque élément
  est un **état** appliqué tel quel (dernier arrivé gagne).
- `applyStockOverrides` (`packages/core/src/stock.ts`, pur) : l'état remplace la disponibilité du
  produit (identifiant `prd…`/SKU) ou de l'option (identifiant d'ingrédient `ing…-typ…`, aussi dans
  une étape imbriquée `parent>ing…`) ; un produit dont un choix obligatoire n'a plus d'option
  disponible devient indisponible ; le prix de livraison propre remplace `modePrices.delivery`
  (à emporter inchangé ; le supplément de règle, nul dans les cartes réelles, n'est pas ajouté).
- `createStockMenuCache` enveloppe le cache de carte : **carte servie, aperçu du back-office et
  calcul serveur du prix** lisent la même carte complétée. Produit hors stock → devis
  `product_unavailable` ; option hors stock → `option_unavailable`. Les états sont relus au plus
  toutes les 5 s par instance, tout de suite sur l'instance qui reçoit l'appel.
- **Mise à jour du catalogue** : carte de la station rechargée (cache vidé) ; les **prix de
  livraison propres** reçus avant `installed_at` sont effacés (le retour au prix du catalogue ne
  donne lieu à aucun appel, §8.2, et un nouveau catalogue fait foi) ; les **disponibilités sont
  gardées** (la caisse renvoie chaque identifiant à son retour en stock ; effacer ferait reparaître
  un article encore hors stock). `catalog_id` 0 : appel de test, sans effet.
- Tableau vide : appel de test, sans effet.

**Limite connue** : l'événement ne porte pas l'heure du changement en caisse (l'horodatage est
celui de la tentative, re-signé à chaque essai). Un état ancien peut donc remplacer un plus récent
si une tentative que nous avons **manquée** (pas de 2xx de notre part) arrive après un appel plus
récent. Les tentatives d'un appel déjà reçu sont, elles, écartées par le dédoublonnage. Répondre
vite est la meilleure protection (guide §6) ; question posée à Splash360.

### Encaissement / annulation (`orders`)

La commande est retrouvée par `order_id` = ticket reçu au dépôt (`orders.pos_ticket_id`), **dans
le restaurant de la station** seulement. `TEST-…` : 2xx sans rien faire. Commande inconnue : noté.
Un événement de l'historique (`pos_paid` ou `pos_cancelled`, auteur `caisse`, motif et heure de
caisse dans `detail`) est posé une seule fois par commande et statut (rejeu manuel idempotent).

- **Annulée en caisse** :
  - pas encore payée (`pending_payment`, `payment_failed`) ou à payer sur place `confirmed` :
    même chemin qu'un refus de la caisse (`cancelForPos`) ; paiement en ligne en cours : le
    PaymentIntent est annulé ;
  - sur place, plus avancée : `changeStatus(cancelled)` comme l'annulation par l'équipe ;
  - payée en ligne : **remboursement intégral du reste** (`refundOrder`, auteur `caisse`, demande
    unique `splash360-cancelled`), comme la compensation d'un refus de la caisse (la commande
    passe à « remboursée ») ; échec Stripe → journal, résultat « Échec », remboursement à faire au
    back-office ;
  - le client est prévenu (notification « annulée »). Fidélité : sur place, rien n'était acquis
    (les points ne le sont qu'à la remise) ; en ligne, les points crédités au paiement ne sont pas
    repris, comme pour tout remboursement aujourd'hui (aucune reprise n'existe, question 6 de
    l'API fidélité).
- **Encaissée en caisse** :
  - à payer sur place, pas encore remise : passage à **remise** (`completed`, auteur `caisse`),
    comme l'équipe ; les points du club sont acquis par `settleLoyalty`, comme aujourd'hui ;
  - payée en ligne : **simple trace**. Seul le webhook Stripe vérifié fait passer une commande à
    « payée » (règle non négociable n° 2) : un « paid » de la caisse ne change jamais le statut
    d'une commande en ligne.
- Arrivée dans le désordre : la machine à états (jamais de retour en arrière, commande terminée
  figée) rend sans effet un « encaissée » arrivé après « annulée », et inversement.

## Conséquences

- Nouvelle variable `SPLASH360_WEBHOOK_SECRETS` (serveur et fonction Edge) ; migration
  `20261128000000_splash360_webhooks.sql`.
- URL à donner à Splash360 : voir `docs/mise-en-production.md`, section « Webhooks Splash360 ».
- Questions à Splash360 (`questions-en-attente.md`) : station de Chicken Street Siège (1274),
  heure du changement en caisse dans les corps, effet d'un nouveau catalogue sur les ruptures.
