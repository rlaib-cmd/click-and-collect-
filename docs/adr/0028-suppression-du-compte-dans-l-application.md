# ADR 0028 — « Supprimer mon compte » dans l'application : même effacement qu'au back-office

- Statut : acceptée (27 novembre 2026)
- Liens : ADR 0005 (journal d'audit), ADR 0019 et 0022 (Ambassadeur), ADR 0023 (cartes
  enregistrées), ADR 0026 (fidélité YouFID), ADR 0027 (bons plans à proximité).

## Contexte

L'App Store (règle 5.1.1(v)) exige qu'une application qui permet de créer un compte permette aussi
d'en demander la suppression depuis l'application. Jusqu'ici, seul le back-office effaçait un
membre du club (`DELETE /v1/admin/loyalty/members/:id`), avec les données « à proximité ».

## Décisions

### Une seule fonction d'effacement

`eraseLoyaltyMember` (`apps/api/src/loyalty/erasure.ts`) sert au back-office et à l'application,
dans cet ordre :

1. **Cartes enregistrées** (lot 18) : chaque carte du client Stripe de la plateforme est détachée,
   puis le lien `stripe_customers` est supprimé. Le client Stripe lui-même (sans donnée
   personnelle : seulement les identifiants d'enseigne et de membre en métadonnées) est conservé.
   C'est la seule étape qui dépend d'un service extérieur : si Stripe échoue, **rien n'est
   effacé** et la demande peut être refaite.
2. **Ambassadeur** : compte Instagram mémorisé (`ambassador_profiles`) et participations **en
   attente** supprimés (aucun crédit ne doit partir vers un compte effacé). Les participations
   **décidées** (confirmées ou refusées) sont gardées, **anonymisées** : membre et compte Instagram
   remplacés par `_efface_`, compte Instagram retiré de l'historique. Elles portent la règle « un
   ticket, une story » (unicité du ticket) et la trace des points crédités.
3. **À proximité** : appareils et événements du membre (comme au lot 22).
4. **Compte** chez le fournisseur : démonstration → compte et mouvements effacés ; YouFID → lien
   local seulement (pas de route d'effacement chez YouFID, ADR 0026).
5. **Sessions** : nouvelle version de session (`loyalty_member_sessions`) : tous les jetons du
   membre, sur tous ses appareils, sont refusés.
6. **Journal** : `loyalty.member.delete` (cartes détachées, participations effacées et
   anonymisées), avec pour auteur le membre de l'équipe ou `client` (identifiant nul). YouFID :
   en plus `loyalty.erasure_requested` (`{ partner: "youfid", dueWithinDays: 30 }`), visible dans
   la page Journal du back-office : l'équipe transmet la demande à Splash360.

Chaque étape est idempotente ; un membre inconnu ou déjà effacé ne produit ni journal ni session.

### Route de l'application

- `DELETE /v1/tenants/:subdomain/loyalty/me`, jeton de membre obligatoire (401 sinon), réponse
  **204** sans corps, `Cache-Control: no-store`. Même plafond par adresse que la connexion au club.
- **Idempotente** : un jeton authentique et non expiré d'un compte déjà effacé reçoit aussi 204
  (réseau coupé après l'effacement, double appui). Un jeton révoqué d'un compte qui existe encore
  (nouvelle connexion par code ailleurs) reste refusé (401).
- Le programme publié (`GET …/loyalty/program`) porte `partnerErasure` (vrai pour YouFID) :
  l'application annonce, avant et après la suppression, l'effacement chez le partenaire sous
  30 jours (`PARTNER_ERASURE_DAYS`, `@splash360/contracts`).

### Application

- Compte → lien discret « Supprimer mon compte » sous la déconnexion → écran qui explique les
  conséquences (points et cadeaux perdus, carte VIP, profil et cartes bancaires effacés, bons plans
  arrêtés, stories en attente non créditées, commandes gardées par le restaurant, action
  définitive) et bouton rouge de confirmation, plus « Garder mon compte ».
- Rien ne change sur l'appareil tant que le serveur n'a pas confirmé. Ensuite : bons plans à
  proximité arrêtés (`disableProximity`, même aide que le retrait de l'accord), jeton effacé de
  l'appareil, retour à l'accueil avec un message à fermer. Web compris (pas de géorepérage).

## Conséquences

- Les **commandes** passées restent (comptabilité du restaurant) avec l'identifiant du membre,
  devenu sans objet ; leurs coordonnées de contact relèvent de l'effacement « client » du
  back-office, distinct du compte club.
- Une nouvelle connexion par code avec le même numéro chez une enseigne YouFID retrouve la fiche
  YouFID tant que Splash360 ne l'a pas effacée : c'est une nouvelle adhésion, voulue par le client.
- Pas de migration : seules des requêtes d'effacement sont ajoutées ; `audit_logs.actor_id` était
  déjà facultatif.

## Réponses du 26/11 (décision du propriétaire)

- L'effacement d'un client **chez YouFID** est demandé **par e-mail à YouFID par l'enseigne
  (le propriétaire)**, dans un délai d'**un mois au plus** (RGPD). Ce n'est pas une fonction de
  l'application : aucune route YouFID n'est appelée et aucun envoi automatique n'est prévu.
- L'application continue d'écrire `loyalty.erasure_requested` au journal du back-office : c'est le
  **rappel** pour l'enseigne d'envoyer cet e-mail. Le délai annoncé au client reste celui de
  `PARTNER_ERASURE_DAYS` (30 jours), compatible avec « un mois au plus » ; aucun changement de code.

