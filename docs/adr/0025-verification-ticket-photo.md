# ADR 0025 — « Achat vérifié » : ticket de caisse photographié, lu par l'IA, vérifié dans les ventes Splash360

Date : 2026-11-25 · Statut : acceptée · Complète les ADR 0019 et 0022

## Contexte

Programme ambassadeur (lots 15 et 17) : une participation est liée à un ticket, scanné (QR) ou saisi,
mais jamais vérifié auprès de la caisse. Réponse de Splash360 (25/11) : les tickets de **caisse**
n'ont pas de QR code ; les tickets de **borne** en ont un, qui sert à payer ensuite au comptoir (un QR
seul ne prouve donc pas le paiement). Le propriétaire veut que le client photographie son ticket,
qu'on en lise l'identifiant par IA et qu'on vérifie auprès de Splash360 que la commande a été payée.

L'export des ventes (`GET https://api2.splash360.fr/api/export/orders`, format relevé le 25/11) donne
pour chaque vente `ticket_id`, `numero` (court, vraisemblablement remis à zéro chaque jour),
`restaurant_id`, `jour_comptable`, `status` (`confirmed` / `deleted`) et `total` (euros). Splash360
n'accepte qu'**un export par minute et par identifiant client** (ADR 0024).

## Décision

1. **Lecture du ticket** (`apps/api/src/loyalty/ticket-read.ts`) : Claude (vision, sortie structurée
   `{ readable, orderNumber, date, time, totalCents }`, `effort: low`), même clé
   (`ANTHROPIC_API_KEY`) et même modèle (`AMBASSADOR_PHOTO_MODEL`, défaut `claude-opus-5-5`) que
   l'analyse de la photo du produit. Consignes en français ; le texte imprimé est traité comme une
   donnée (garde contre l'injection d'instructions). Le serveur revérifie la sortie : numéro
   (préfixe « N° » retiré, majuscules, sans espaces, zéros de tête retirés d'un numéro purement
   numérique, `[A-Z0-9/-]{1,20}`), date réelle, total entier entre 0 et 10 000 €. Tout champ
   indispensable manquant, refus du modèle ou panne = « illisible ». Sans clé : lecture manuelle =
   « illisible », le client tape le numéro. **La photo n'est ni stockée ni journalisée.**
2. **Route** `POST /v1/tenants/:s/ambassador/ticket-photo` (membre connecté, même format, même
   taille — 4 Mo — et même plafond de débit que `photo-check`, compté à part). Réponse
   `{ readable, orderNumber, date, totalCents, token }`. Le jeton (préfixe `r1.`, HMAC avec un
   motif distinct de celui de la photo, 30 min) porte les données lues et est lié à l'enseigne et
   au membre. **Fenêtre** : ticket du jour ou des `TICKET_PHOTO_MAX_AGE_DAYS` = 7 jours précédents
   (journée de Paris) ; une date future ou plus ancienne est refusée avec un message en français,
   ici et de nouveau à la participation.
3. **Participation** : `ticketPhoto` (jeton) exclusif de `ticketQr` ; `ticketRef` devient facultatif
   avec lui. Le serveur déduit la référence `AAAAMMJJ-NUMERO-TOTAL` (ex. `20261124-6-1230`),
   déterministe et au format des tickets : la contrainte unique (enseigne, ticket) garantit une
   participation par ticket. Il enregistre `ticket_date`, `ticket_number`, `ticket_total_cents` et
   `ticket_check = 'pending'`, et journalise `ticket_read`. Un ticket scanné ou saisi garde le
   comportement existant (`ticket_check = 'unverified'`, « non vérifié »).
4. **Copie des ventes** (migration `20261125100000_ambassador_ticket_photo.sql`) : `pos_sales`
   (enseigne, `ticket_id`, restaurant Splash360, journée, numéro normalisé, statut, total en
   centimes — ni client, ni lignes, ni règlements) et `pos_sales_sync` (avancement par enseigne et
   par journée). `tenant_id`, RLS sans règle (accès serveur seulement), pgTAP. Lecture de l'export
   dans `packages/api-menu` (`readSalesPage`, enveloppe stricte, vente lue champ par champ ; une
   vente illisible est ignorée et comptée, sans bloquer la page ; euros → centimes par
   `Math.round(total × 100)`).
5. **Vérification** (`verifyAmbassadorTickets`, lancée juste avant `processAmbassadorEntries` par la
   même tâche périodique) :
   - **au plus une page** de l'export par passage (un seul identifiant client par serveur), pour la
     journée la plus ancienne encore incomplète, 100 ventes, `status=confirmed,deleted` ; sur 429
     (pause d'une minute) le passage saute la lecture, sur une autre erreur il la journalise ;
   - seules les ventes des restaurants **branchés** (`splash360_live`) de l'enseigne sont copiées ;
   - une journée n'est **complète** qu'après une lecture entière commencée une fois la journée
     terminée (heure de Paris) : l'ordre des ventes dans l'export n'étant pas garanti, une lecture
     commencée pendant la journée recommence au début à la page suivante ;
   - rapprochement : même journée comptable, même numéro (sans casse ni espaces), même total, restaurant
     branché de l'enseigne. Vente encaissée → `verified` ; seulement annulée → `unpaid` et
     participation **refusée** (« Commande annulée en caisse ») dans la même transaction ; journée
     complète sans vente → `not_found` et participation « à vérifier » (l'équipe tranche avec
     « Valider maintenant » ou « Refuser ») ; sinon le ticket reste `pending` ;
   - résultats écrits par mise à jour conditionnelle (`ticket_check = 'pending'`), avec l'événement
     `ticket_checked` dans la même transaction : idempotent et sûr à plusieurs exemplaires.
6. **Jamais de crédit automatique** tant que `ticket_check` vaut `pending`, `not_found` ou `unpaid`
   (exclu de `dueEntries` et revérifié dans `processAmbassadorEntries`). `verified` et `unverified`
   suivent le parcours existant (mention, contrôle, crédit). L'équipe garde la main.
7. **Sans accès aux ventes** (serveur sans identifiants Splash360, ou enseigne sans restaurant
   branché) : le ticket reste `pending` (donc jamais crédité automatiquement) et la participation
   passe « à vérifier » une seule fois, avec l'événement `ticket_checked` (`unavailable`).
8. **Affichage** : `ticketCheck` dans les réponses du membre et du back-office (avec les données
   lues). Application : « Prendre mon ticket en photo » en premier choix (version web, comme la
   photo du produit), données lues à confirmer par le client, repli sur la saisie si illisible ;
   historique « Achat vérifié » / « Vérification du ticket en cours » / « Ticket introuvable :
   vérification par le restaurant ». Textes dans `packages/i18n`.

## Conséquences

- Un ticket photographié n'apporte de points qu'une fois l'achat retrouvé dans les ventes (ou
  validé par l'équipe) ; le QR et la saisie restent possibles mais « non vérifiés ».
- Une page par minute : une journée de 500 ventes se lit en 5 minutes ; une journée en cours est
  relue en boucle tant que des tickets du jour attendent. Si l'export d'une journée échoue sans
  cesse, les journées suivantes attendent (journalisé).
- Deux tickets de la même enseigne avec la même journée, le même numéro et le même total (deux
  restaurants dont les numéros se recoupent) donnent la même référence : le second est refusé comme
  « déjà utilisé ». Cas jugé marginal.
- Au plus 200 tickets `pending` examinés par passage, les plus anciens d'abord.

## Points à confirmer avec Splash360 (questions-en-attente n° 17)

- Le **numéro imprimé** sur le ticket de caisse est-il bien `numero` de l'export (et pas `chrono`) ?
  Remis à zéro chaque jour, par restaurant ?
- `jour_comptable` d'une vente après minuit (service tardif) : la date imprimée peut différer de la
  journée comptable ; une telle vente sera « introuvable » et tranchée par l'équipe.
- Numérotation des pages de l'export (`page` commence à 0 comme le client actuel, ou à 1 ?).
- Les ventes synchronisées en retard par une caisse hors ligne peuvent apparaître après qu'une
  journée a été déclarée complète (ticket « introuvable », tranché par l'équipe).
