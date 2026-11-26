# Lot 23 — Recevoir les webhooks Splash360

**Demande** (propriétaire, 26/11) : brancher les quatre webhooks décrits par Splash360 dans son
« guide d'intégration des partenaires click and collect » (transcrit dans
`docs/api-splash360/webhooks.md`) : disponibilité des articles, prix de livraison propres, mise à
jour du catalogue, encaissement / annulation de commande. Décisions : ADR 0029.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Transcription fidèle du guide (`docs/api-splash360/webhooks.md`) |
| 2 | `packages/api-menu/src/splash360/webhooks.ts` : secrets `whsec_…` (`parseWebhookSecrets`), signature Standard Webhooks sur les octets reçus (`verifyWebhookSignature`, temps constant, ± 5 min, plusieurs signatures), challenge, corps des quatre événements traduits en types internes (snake_case, champs inconnus ignorés, élément illisible écarté), appels de test |
| 3 | `packages/core/src/stock.ts` : `applyStockOverrides` (disponibilité produit et option, étapes imbriquées comprises, choix obligatoire devenu impossible, prix de livraison propre sur `modePrices.delivery`) |
| 4 | Migration `20261128000000_splash360_webhooks.sql` : `restaurants.splash360_station_id` (unique), `menu_stock_overrides` (RLS sans politique), `splash360_private.webhook_receipts` ; magasins Postgres et mémoire (`packages/db/src/splash360-webhooks.ts`), station du restaurant, commande par ticket de caisse, trace « caisse » unique, motif dans l'historique |
| 5 | API : `POST /v1/webhooks/splash360/:event/:stationId` (401 sans motif, 503 sans secret, challenge, 2xx immédiat, dédoublonnage, station inconnue journalisée sur 4 caractères), traitement en tâche de fond (`background` : `EdgeRuntime.waitUntil` sur Edge), carte complétée des états de la caisse pour l'application, le back-office et le calcul du prix (`createStockMenuCache`), annulation et encaissement par les chemins existants, purge horaire à 7 jours ; variable `SPLASH360_WEBHOOK_SECRETS` |
| 6 | Back-office (super-administrateur) : station Splash360 de chaque restaurant (page Paiement), nombre d'articles hors stock et de prix propres, journal « Webhooks reçus » (100 derniers, sans donnée personnelle) ; motif d'annulation de la caisse dans l'historique de la commande |

## Vérifications

- Signature (`webhooks.test.ts`, api-menu) : vecteur de test du guide trouvé exactement ; JSON
  re-sérialisé refusé ; deux signatures (bascule) ; deux secrets ; signature fausse, absente ou
  `v2` ; horodatage à plus de 5 min dans les deux sens ; secret illisible sans sa valeur.
- Corps : challenge, disponibilités, prix (euros → centimes), catalogue et test `catalog_id` 0,
  commande et test `TEST-`.
- Carte (`stock.test.ts`, core) : produit et option hors stock (devis refusé), étape imbriquée,
  choix obligatoire impossible, prix de livraison propre (livraison seulement).
- Routes (`splash360-webhooks.test.ts`, api) : vecteur de test par la route (horloge injectée),
  octets différents refusés, 401 sans corps, horodatage périmé, 503 sans secret, 404 événement
  inconnu, challenge, dédoublonnage (une tentative en retard ne réapplique pas un ancien état),
  station inconnue (2xx, 4 caractères au journal), corps illisible, hors stock sur la carte et au
  devis, appels de test, prix de livraison en livraison et au devis, catalogue (prix effacés,
  disponibilités gardées), sur place encaissée (remise, points acquis, idempotente), sur place
  annulée (motif), en ligne annulée (remboursée une fois), en ligne « encaissée » (jamais payée
  sans Stripe), `TEST-` et commande inconnue, commande d'un autre restaurant, back-office (station
  réservée au super-administrateur et unique, compteurs, journal), purge à 7 jours.
- Postgres (`splash360-webhooks.integration.test.ts`) : station, dédoublonnage, enseigne
  incohérente refusée, purge, états et comptes, prix effacés au catalogue, commande par ticket
  (casse indifférente, restaurant et enseigne contrôlés), trace unique. pgTAP
  `splash360_webhooks_test.sql`.

## Ce qui reste

- **Splash360** : déclarer les quatre URL (recette puis production, voir
  `mise-en-production.md`), nous transmettre les secrets, et dire quel identifiant de station
  correspond à Chicken Street Siège (1274) pour le régler au back-office.
- Poser `SPLASH360_WEBHOOK_SECRETS` en secret de la fonction Edge (recette) et du serveur
  (production), appliquer la migration, puis demander à Splash360 un challenge et les appels de
  test (§8.5) : ils apparaissent dans « Webhooks reçus ».
- Questions ouvertes (`questions-en-attente.md`, n° 19 et 22).
