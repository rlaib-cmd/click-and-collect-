# ADR 0027 — « Bons plans à proximité » : zones autour des restaurants, décision côté serveur

- Statut : acceptée (lot 22, 27 novembre 2026)
- Liens : ADR 0002 (le client passe par l'API), ADR 0010 et 0013 (membres du club), ADR 0017
  (droits du back-office), ADR 0026 (fidélité YouFID).

## Contexte

Le propriétaire veut qu'un client passant à environ 200 m d'un restaurant puisse recevoir une
notification push, avec des règles (fréquence, heures, cible). Pas de service tiers de
géorepérage : on s'appuie sur la surveillance de zones du système (iOS Core Location, Android
Geofencing API) via `expo-location` et `expo-task-manager` (SDK Expo 58).

## Décisions

### Accord et identité

- **Membres du club seulement** : la fonction exige une session de membre (jeton `m2`). Le membre
  a une identité stable (cible, plafonds, attribution des commandes) et un consentement attaché à
  son compte ; un client invité n'a ni l'un ni l'autre. Retenu pour la simplicité du consentement.
- **Accord distinct, désactivé par défaut** : Compte → « Bons plans à proximité », qui explique
  l'usage avant toute demande d'autorisation. Rien n'est demandé au démarrage.
- Autorisations demandées dans l'ordre, au geste du membre : notifications, position « pendant
  l'utilisation », puis position « toujours ». Un refus est expliqué avec un lien vers les
  réglages du téléphone, sans nouvelle demande. Web : fonction masquée (`geofence.web.ts`).
- **Retrait à tout moment** : interrupteur coupé → surveillance arrêtée, appareil effacé côté
  serveur (`POST …/proximity/opt-out`), état local supprimé. Même chose à la déconnexion, si un
  autre membre se connecte sur le téléphone, ou si la position « toujours » a été retirée dans
  les réglages (constaté au démarrage suivant).

### Zones

- L'application lit `GET /v1/tenants/:subdomain/proximity` (membre connecté) : fonction active,
  rayon (100 à 1 000 m, défaut 200 m) et restaurants actifs avec coordonnées (`restaurants.latitude`,
  `longitude`). Au plus **20 zones** (limite iOS), les plus proches de la dernière position connue
  (`getLastKnownPositionAsync`, sans nouvelle mesure) ; sans position, les 20 premières.
- `Location.startGeofencingAsync(tâche, zones)` avec `notifyOnEnter` seulement ; la tâche est
  définie en portée globale (`TaskManager.defineTask`), importée par le layout racine. Les zones
  sont rafraîchies à chaque démarrage de l'application.
- À l'entrée, la tâche appelle `POST /v1/tenants/:subdomain/proximity/enter` avec le seul
  identifiant du restaurant (la `identifier` de la zone). **Aucune position n'est envoyée ni
  stockée.**

### Décision côté serveur

- Fonction pure `decideProximityPush` (`packages/core/src/proximity.ts`), dans cet ordre :
  fonction active → appareil inscrit → restaurant actif avec coordonnées → heures calmes (heure
  locale du restaurant, défaut Europe/Paris, plage pouvant passer minuit) → horaires d'ouverture
  du restaurant (table `opening_hours`, fermetures exceptionnelles comprises ; option) → plafond
  par membre (défaut 1 par 24 h, tous restaurants) → plafond par membre et restaurant (défaut
  7 jours) → cible.
- Cibles : tous les membres ayant donné leur accord ; membres ayant un cadeau disponible (solde
  `LoyaltyProvider.getMember` ≥ cadeau le moins cher de `getProgram` ; fidélité muette → pas
  d'envoi) ; membres inactifs depuis N jours (dernière commande validée dans notre base ; jamais
  commandé = inactif).
- Les plafonds ne comptent que les envois réels. Deux entrées simultanées : la réservation de
  l'envoi (`claimSend`) se fait sous verrou consultatif Postgres par membre ; une seule passe.
- Envoi par le service Expo existant (`NotificationSender.push`) aux appareils inscrits du membre
  (table dédiée `proximity_devices`, distincte de `order_push_tokens` qui est par commande).
  Données jointes : `{ kind: "proximity", eventId, link }`. Échec Expo → événement « failed »,
  qui ne consomme pas le plafond.
- Titre et texte réglés par l'enseigne, `{restaurant}` remplacé par le nom du restaurant ; lien
  d'ouverture parmi `home`, `commander`, `avantages` (pas d'URL libre).
- Fonction coupée ou appareil non inscrit : réponse `{ notified: false }` et **rien n'est
  enregistré**. Restaurant inconnu ou d'une autre enseigne : 404.
- Entrée limitée par adresse IP avec le limiteur des commandes (20 par minute par défaut).

### Données

Migration `20261127000000_proximity_push.sql`, trois tables avec `tenant_id`, RLS active sans
politique (accès serveur seulement), tests pgTAP `supabase/tests/proximity_test.sql` :

- `proximity_settings` : règles de l'enseigne (désactivée par défaut).
- `proximity_devices` : jeton push Expo, membre, plateforme (accord donné). Un jeton déjà inscrit
  passe au membre qui se connecte.
- `proximity_events` : membre, restaurant, instant, décision (`sent`, `skipped`, `failed`),
  raison, ouverture. Pas de colonne de position. Restaurant de la même enseigne (déclencheur
  `check_same_tenant`). **Purge après 90 jours** par la tâche périodique de l'API (toutes les
  heures, serveur Node et fonction Edge), pg_cron n'étant pas disponible partout.
- Effacement d'un membre au back-office : appareils et événements supprimés avec lui.

### Back-office

- Page « Bons plans à proximité » réservée au **gérant** (nouveau droit `proximity` : gérant et
  super-administrateur, pas le rôle « manager » ni l'équipier) : règles et résultats.
- Statistiques sur 7 et 30 jours : envois, ouvertures (toucher de la notification → l'application
  appelle `POST …/proximity/opened` avec `eventId`, membre vérifié, une seule fois), commandes
  validées du membre dans les **2 h** suivant l'envoi (attribution simple, sans exclusivité), et
  nombre de membres ayant activé la fonction.

## Conséquences

- **Nouveau build natif obligatoire** (EAS) : `expo-location` et `expo-task-manager`, mode
  d'arrière-plan iOS `location`, permission Android `ACCESS_BACKGROUND_LOCATION`. Une mise à jour
  OTA seule ne suffit pas, et serait dangereuse : le JavaScript du lot 22 charge des modules
  natifs absents des builds actuels. **La `version` de l'application (`app.json`) doit être
  augmentée avant ce build** : `runtimeVersion` suit la version (`policy: appVersion`), ainsi les
  mises à jour OTA de ce code n'atteignent jamais les anciens binaires.
- `expo-task-manager` ajoute automatiquement le mode d'arrière-plan iOS `fetch` (greffon appliqué
  par défaut) ; il n'est pas utilisé ici.
- Revue Apple : la position « Toujours » doit être justifiée (texte dans
  `docs/mise-en-production.md`). Google Play : déclaration « position en arrière-plan » avec
  vidéo de démonstration.
- Comportement réel des zones non vérifiable en intégration continue : iOS relance l'application
  terminée à l'entrée dans une zone ; Android ne relance pas une application terminée par
  l'utilisateur (selon les fabricants), la notification peut alors ne pas partir. La précision
  des zones est de l'ordre de 100 à 200 m et l'entrée peut être signalée avec quelques minutes
  de retard.
- iOS signale l'état initial des zones au démarrage : un membre déjà dans une zone peut déclencher
  une entrée ; les plafonds côté serveur empêchent les répétitions.
