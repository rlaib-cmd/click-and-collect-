# Lot 22 — Bons plans à proximité (notifications autour des restaurants)

**Demande** (propriétaire) : quand un client passe à environ 200 m d'un restaurant, l'application
peut lui envoyer une notification push, selon des règles réglées par l'enseigne. Construit sans
service tiers de géorepérage. Décisions : ADR 0027.

Avant le lot, même journée : le client YouFID n'utilise plus que les routes nécessaires
(1, 2, 3, 5, 6, 7, 10, 12), à la demande de Splash360 ; la question de profil en attente est lue
sur la route 3 au lieu de la route 11 (ADR 0026).

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Règles pures (`packages/core/src/proximity.ts`) : `decideProximityPush` (fonction active, appareil inscrit, restaurant disponible, heures calmes passant minuit, horaires d'ouverture et fermetures, plafond par membre, plafond par restaurant, cibles « tous », « cadeau disponible », « inactifs depuis N jours »), texte avec `{restaurant}`, validation, 20 zones les plus proches ; droit `proximity` (gérant, super-administrateur) |
| 2 | Contrats zod (`packages/contracts/src/proximity.ts`) : règles, statistiques, zones, appareil, retrait, entrée, ouverture, données de la notification |
| 3 | Migration `20261127000000_proximity_push.sql` : `proximity_settings` (désactivée par défaut), `proximity_devices`, `proximity_events` (sans position) ; RLS sans politique ; magasin Postgres et mémoire (`packages/db/src/proximity.ts`) avec réservation d'envoi sous verrou par membre |
| 4 | API membre : `GET /v1/tenants/:s/proximity`, `PUT …/proximity/device`, `POST …/proximity/opt-out`, `POST …/proximity/enter` (limité par adresse avec le limiteur des commandes), `POST …/proximity/opened` ; envoi par le service push Expo existant ; purge horaire des événements de plus de 90 jours (serveur Node et fonction Edge) ; effacement avec le membre |
| 5 | Back-office : `GET /v1/admin/proximity`, `PUT /v1/admin/proximity/settings` (journalisé) ; page « Bons plans à proximité » : règles et résultats 7 et 30 jours (envois, ouvertures, commandes dans les 2 h, membres inscrits) |
| 6 | Application : Compte → « Bons plans à proximité » (membres seulement, iOS et Android ; masqué sur le web) ; accord explicite, refus expliqués avec lien vers les réglages ; `expo-location` + `expo-task-manager` (installés par `npx expo install`) ; tâche de zones définie au chargement ; zones rafraîchies au démarrage ; arrêt et effacement à la déconnexion ; toucher de la notification suivi puis écran choisi ; permissions iOS « Toujours » et Android arrière-plan dans `app.json` |

## Vérifications

- Règles (`proximity.test.ts`, core) : envoi nominal, désactivée par défaut, sans appareil,
  restaurant indisponible, heures calmes 22:00 → 08:00 (bords compris), plage de jour, heure
  d'été, horaires d'ouverture et fermeture exceptionnelle, plafonds membre et restaurant, cibles
  cadeau (solde absent compris) et inactifs, ordre des règles, 20 zones les plus proches.
- Contrats : rayon, heures, lien, jeton Expo, aucune position acceptée à l'entrée.
- Routes (`apps/api/src/routes/proximity.test.ts`) : sans session → 401 ; zones ; accord absent
  ou fonction coupée → rien d'envoyé ni d'enregistré ; envoi avec nom du restaurant et données ;
  plafond 24 h ; heures calmes et restaurant fermé ; cible cadeau ; restaurant inconnu ou d'une
  autre enseigne → 404 ; retrait de l'accord ; échec Expo sans consommer le plafond ; limite de
  débit ; back-office (validation, droits, statistiques, ouverture par le seul bon membre,
  journal). Matrice des droits (`roles.test.ts`) complétée.
- Postgres (`proximity.integration.test.ts`) : règles, appareils, réservation simultanée (une
  seule), plafonds, échec, ouverture, restaurant d'une autre enseigne refusé, dernière commande,
  attribution 2 h, purge 90 jours, effacement d'un membre. pgTAP `proximity_test.sql`.
- Application (`apps/mobile/src/proximity/regions.test.ts`) : 20 zones les plus proches, sans
  position, lien d'ouverture, reconnaissance des notifications, état local, déconnexion ou autre
  membre.

## Ce qui reste

- **Nouveau build EAS** (augmenter la version de l'application d'abord) et notes de revue Apple
  et Google : voir `docs/mise-en-production.md`, section « Bons plans à proximité ».
- Vérification sur de vrais téléphones (iPhone, Android) : délai et précision de détection,
  application terminée (Android ne relance pas toujours l'application), demande « Toujours ».
- Clients invités (non membres) : hors périmètre, à décider si besoin.
