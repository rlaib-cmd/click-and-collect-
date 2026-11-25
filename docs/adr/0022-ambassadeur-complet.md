# ADR 0022 — Ambassadeur complet : compte mémorisé, photo analysée, mention, délais, historique

Date : 2026-11-25 · Statut : acceptée · Complète l'ADR 0019

## Contexte

Retours de l'utilisateur sur le lot 15 :

- une seule carte sur l'accueil, la rouge « Tag en Story {enseigne} et gagne {bonus} points ;) » ;
- le compte Instagram du client est saisi **une fois**, enregistré, puis affiché dans une case grisée
  avec un bouton « Modifier » à côté ;
- **une participation par achat**, avec un historique complet (« il faut que ce soit vraiment logué »)
  et un parcours sécurisé ;
- les points sont crédités **24 h après la publication** ; un contrôle « la story est-elle toujours
  en ligne ? » vers **20 h** ;
- la photo doit montrer un produit de l'enseigne (« pas une tour Eiffel »).

L'API Meta (lecture des mentions et des stories) n'est pas encore disponible (compte Meta Business,
application validée : questions-en-attente n° 17). Splash360 ne vérifie pas encore les tickets.

## Décision

1. **Compte Instagram mémorisé** : table `ambassador_profiles` (une ligne par membre et par enseigne,
   `tenant_id`, RLS sans règle, pgTAP). `GET/PUT /v1/tenants/:s/ambassador/profile` ; chaque
   participation met aussi à jour le compte mémorisé.
2. **Étapes d'une participation** (`ambassador_entries`) : `pending` → « Mention reçue » (bouton du
   back-office, horodaté, auteur noté) → contrôle à `mention + check_after_hours` → crédit à
   `mention + credit_after_hours`. Les échéances sont figées au moment de la mention. Délais réglables
   par enseigne (`ambassador_settings`, 20 h et 24 h par défaut, contrôle avant crédit). « Refuser »
   reste possible jusqu'au crédit ; « Valider maintenant » (permission `loyalty.validate` :
   propriétaire et Splash360) crédite tout de suite.
3. **Contrôle de la story** : interface `StoryChecker`. En attendant Meta, `manualStoryChecker` répond
   « en ligne » : le restaurant garde la main avec « Refuser ». Un contrôle « retirée » refuse la
   participation automatiquement.
4. **Crédit** : toujours par `confirmAmbassadorEntry` (passage atomique `pending` → `confirmed`, un
   seul crédit même en cas d'appels simultanés).
5. **Historique** : table `ambassador_events` (créée, photo analysée et verdict, mention reçue et par
   qui, contrôle et résultat, crédit, échec de crédit, refus et par qui). Chaque événement est écrit
   dans la même transaction que le changement d'étape. Un déclencheur refuse un événement rattaché à
   une participation d'une autre enseigne.
6. **Tâche périodique « ambassadeur »** (`processAmbassadorEntries`) : bornée (20 participations par
   passage), idempotente (mises à jour conditionnelles). Serveur Node : toutes les minutes. Edge :
   au fil du trafic client, au plus une fois par minute, comme les envois en caisse.
7. **Analyse de la photo** (`POST /v1/tenants/:s/ambassador/photo-check`, membre connecté) :
   - image JPEG, PNG ou WebP de 4 Mo au plus (type vérifié sur les premiers octets), limite de corps
     propre à cette route, débit limité (6 analyses par minute et par adresse) ;
   - **jamais conservée** : ni en base, ni dans les journaux ; seuls le verdict et sa raison le sont ;
   - Claude (vision, sortie structurée `accepted` / `rejected` / `doubtful` + raison courte en
     français), avec la catégorie de l'enseigne (réglage `photo_category`) et les noms des produits
     de la carte (API menu, via `packages/api-menu`) ; modèle `claude-opus-5-5`, effort bas,
     remplaçable par `AMBASSADOR_PHOTO_MODEL` ;
   - refus du modèle, réponse illisible ou panne : « doubtful » (jamais bloquant, l'équipe tranche) ;
   - **sans `ANTHROPIC_API_KEY`** : vérification manuelle (« doubtful ») ; aucune clé dans le dépôt ;
   - le verdict est rendu au client avec un **jeton signé** (HMAC, 30 min, lié à l'enseigne et au
     membre) que la participation renvoie : un verdict fabriqué par le client est ignoré. Photo
     refusée → participation refusée ; douteuse ou sans jeton valable → « à vérifier ».
8. **Consentement** : une ligne avant l'envoi de la photo, et un paragraphe « Programme
   ambassadeur » dans les conditions de l'application (textes dans `packages/i18n`).
9. **Ticket** : l'application affiche « Ticket enregistré · Ticket {réf.} », jamais « Achat vérifié »,
   tant que Splash360 ne vérifie pas les tickets.
10. **Partage** : web, Web Share API avec le fichier image (sinon téléchargement) ; le compte à taguer
    est copié **sans « @ »** au même moment, avec le message « Nom copié, colle-le dans le sticker
    @Mention » ; « @compte » est dessiné sur le cadre. Application installée : feuille de partage de
    React Native (texte), `expo-sharing` et `expo-clipboard` n'étant pas installés (nouveau build EAS).

## Conséquences

- Migration `20261125070000_ambassador_flow.sql` à appliquer en recette puis en production.
- Secret `ANTHROPIC_API_KEY` à poser (fonction Edge / serveur) pour activer l'analyse ; sans lui,
  toutes les photos sont « à vérifier ».
- Le jeton de verdict peut servir à plusieurs tickets du même membre pendant 30 minutes : chaque
  ticket reste une participation distincte, contrôlée à la mention par le restaurant.
- Quand Meta sera branché : une implémentation de `StoryChecker`, et « Mention reçue » pourra être
  déclenché par le webhook des mentions.
