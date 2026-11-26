# ADR 0025 — « Achat vérifié » : ticket identifié par son `ticket_id` Splash360, vérifié dans l'export des ventes

Date : 2026-11-25 · Statut : acceptée · Complète les ADR 0019 et 0022

## Contexte

Programme ambassadeur (lots 15 et 17) : une participation est liée à un ticket, scanné (QR) ou saisi,
mais jamais vérifié auprès de la caisse. Le propriétaire veut que le client photographie son ticket,
qu'on en lise l'identifiant par IA et qu'on vérifie auprès de Splash360 que la commande a été payée.

Réponses de Splash360 (25/11) :

- le **`ticket_id`** (UUID, le même que dans l'export des ventes) est **imprimé en texte** sur le
  ticket de caisse ; le **QR des tickets de borne** encode **ce même `ticket_id`** (il sert à payer
  ensuite au comptoir : un QR seul ne prouve donc pas le paiement) ;
- **journée comptable** (`jour_comptable`) : une vente faite **avant 02:00** (heure de Paris)
  appartient à la veille ; à partir de 02:00, à sa journée du calendrier ;
- la **pagination** de l'export des ventes commence à **0** en pratique (annoncée « à partir de 1 », mais le 25/11, `page=1` renvoyait la deuxième page : 28 ventes en page 0, aucune en page 1 avec `pageSize=100`) ;
- au plus **un export par minute et par identifiant client** (ADR 0024).

Disposition d'un vrai ticket de caisse (Chicken Street Siège, Splash360 1.4.13) : nom et adresse, un
grand « #22 » (`numero`), juste en dessous **l'UUID seul sur sa ligne, sans libellé**, puis
« 25 nov. 2026 a 19:04:27 », le mode (« *** SUR PLACE *** »), les articles, « TOTAL TTC 10,00 »,
la TVA, « REGLEMENT : CB 10,00 EUR ». En bas, une **autre** référence à ne pas confondre :
« Ticket : T2611-c1907-00457 » (numéro fiscal NF525), « Caisse : 1907 », la ligne NF525.

## Décision

1. **Journée comptable** (`apps/api/src/loyalty/business-day.ts`) : constante
   `BUSINESS_DAY_CUTOFF = '02:00'`, fuseau `Europe/Paris` (changements d'heure compris). Un ticket
   dont l'heure est lue a **une** journée comptable (la veille si l'heure est avant 02:00) ; si
   l'heure est illisible, la **date imprimée et la veille** sont possibles. Une journée est
   **terminée** à 02:00 (Paris) le lendemain.
2. **Lecture du ticket** (`apps/api/src/loyalty/ticket-read.ts`) : Claude (vision, sortie
   structurée `{ readable, ticketId, date, time, totalCents }`, `effort: low`), même clé
   (`ANTHROPIC_API_KEY`) et même modèle (`AMBASSADOR_PHOTO_MODEL`, défaut `claude-opus-5-5`) que
   l'analyse de la photo du produit. Les consignes décrivent la disposition ci-dessus : l'identifiant
   est l'UUID sous le « #numéro », **jamais** la valeur « Ticket : T… » du bas ; date en français
   abrégé (janv. … déc.) rendue en AAAA-MM-JJ, heure HH:MM, total à virgule en centimes ; le texte
   imprimé est une donnée (garde contre l'injection d'instructions). Contrôle serveur :
   - UUID strict (8-4-4-4-12 hexadécimal), espaces et retours à la ligne retirés, en minuscules ;
     s'il n'est pas valide, seules les confusions de lecture O/o → 0 et I/l → 1 sont corrigées, et
     le résultat n'est gardé que s'il est un UUID ;
   - `readable` seulement avec un UUID valide **et** une date réelle ; heure et total facultatifs.
   Refus du modèle, panne ou réponse illisible = « illisible » ; sans clé, le client tape le numéro.
   **La photo n'est ni stockée ni journalisée.**
3. **Route** `POST /v1/tenants/:s/ambassador/ticket-photo` (membre connecté, même format, même
   taille — 4 Mo — et même plafond de débit que `photo-check`, compté à part). Réponse
   `{ readable, ticketId, date, time, totalCents, token }`. Le jeton (préfixe `r1.`, HMAC avec un
   motif distinct de celui de la photo, 30 min) porte les données lues, lié à l'enseigne et au
   membre. **Fenêtre** : journée comptable du ticket dans les `TICKET_PHOTO_MAX_AGE_DAYS` = 7 jours
   (journée comptable de Paris), ni future ; avec une heure illisible, le ticket est accepté si
   l'une des deux journées possibles convient. Vérifiée ici et de nouveau à la participation.
4. **Participation** : `ticketPhoto` (jeton) exclusif de `ticketQr` ; `ticketRef` facultatif avec
   lui. La référence d'un ticket identifié est son **`ticket_id` en majuscules** (36 caractères) :
   la contrainte unique (enseigne, ticket) garantit une participation par vente. **QR de borne** :
   si le contenu du QR contient un UUID (seul ou dans une URL), c'est le `ticket_id` ; même
   référence, ticket « à vérifier », sans date ni total. Un QR sans UUID ou un numéro saisi restent
   « non vérifiés » (`unverified`, comportement des lots 15 et 17). Événement `ticket_read`.
5. **Copie des ventes** : `pos_sales` (enseigne, `ticket_id` en minuscules — clé primaire —,
   restaurant Splash360, journée, statut, total en centimes ; ni client, ni lignes, ni règlements)
   et `pos_sales_sync` (avancement par enseigne et par journée, page suivante à partir de 0).
   `tenant_id`, RLS sans règle (accès serveur seulement), pgTAP. Lecture de l'export dans
   `packages/api-menu` (`readSalesPage` : enveloppe stricte, vente lue champ par champ, `ticket_id`
   UUID ; une vente illisible est ignorée et comptée ; euros → centimes par `Math.round(total × 100)`).
6. **Vérification** (`verifyAmbassadorTickets`, juste avant `processAmbassadorEntries`, même tâche) :
   - journées à lire : journée comptable du ticket ; heure illisible : date imprimée et veille ;
     QR (sans date) : journée comptable de la participation et la précédente ;
   - **au plus une page** de l'export par passage (un identifiant client par serveur) : la journée
     la plus ancienne encore incomplète, 100 ventes, `status=confirmed,deleted`, pages à partir de
     1 ; sur 429 le passage saute la lecture, sur une autre erreur il la journalise ;
   - seules les ventes des restaurants **branchés** (`splash360_live`) de l'enseigne sont copiées ;
   - une journée n'est **complète** qu'après une lecture entière commencée une fois la journée
     terminée (02:00 le lendemain) : l'ordre des ventes n'étant pas garanti, une lecture commencée
     plus tôt recommence à la page 0 ;
   - rapprochement **par `ticket_id`** (sans casse), restaurant branché de l'enseigne, quelle que
     soit la journée où la vente a été copiée. Vente encaissée → `verified` ; seulement annulée →
     `unpaid` et participation **refusée** (« Commande annulée en caisse ») dans la même
     transaction ; toutes les journées possibles complètes sans la vente → `not_found` et
     participation « à vérifier » (l'équipe tranche) ; sinon `pending`. Un total lu différent du
     total de la vente est noté dans l'événement (`totalDiffers`), sans effet sur le résultat ;
   - résultats écrits par mise à jour conditionnelle (`ticket_check = 'pending'`), avec l'événement
     `ticket_checked` dans la même transaction : idempotent et sûr à plusieurs exemplaires.
7. **Jamais de crédit automatique** tant que `ticket_check` vaut `pending`, `not_found` ou `unpaid`
   (exclu de `dueEntries` et revérifié dans `processAmbassadorEntries`). `verified` et `unverified`
   suivent le parcours existant (mention, contrôle, crédit). L'équipe garde la main.
8. **Sans accès aux ventes** (serveur sans identifiants Splash360, ou enseigne sans restaurant
   branché) : le ticket reste `pending` (jamais crédité automatiquement) et la participation passe
   « à vérifier » une seule fois, avec l'événement `ticket_checked` (`unavailable`).
9. **Affichage** : `ticketCheck` dans les réponses du membre et du back-office (avec identifiant,
   date, heure et total lus). Application : « Prendre mon ticket en photo » en premier choix
   (version web, comme la photo du produit), identifiant raccourci (8 caractères), date, heure et
   montant à confirmer, repli sur la saisie si illisible ; historique « Achat vérifié » /
   « Vérification du ticket en cours » / « Ticket introuvable : vérification par le restaurant ».
   Textes dans `packages/i18n`.
10. **Migrations** : `20261125100000_ambassador_ticket_photo.sql` (déjà en recette, inchangée) puis
    `20261125110000_ambassador_ticket_id.sql` : `ticket_number` remplacé par `ticket_id` (uuid),
    `ticket_time` ajouté, `pos_sales.numero` supprimé, pages à partir de 1. Les participations déjà
    photographiées avec l'ancien numéro (sans identifiant) redeviennent « non vérifiées » et passent
    « à vérifier » si elles sont encore en attente.

## Conséquences

- Un ticket photographié ou un ticket de borne scanné n'apporte de points qu'une fois la vente
  retrouvée encaissée (ou la participation validée par l'équipe) ; la saisie reste possible mais
  « non vérifiée ».
- Une page par minute : une journée de 500 ventes se lit en 5 minutes ; une journée en cours est
  relue en boucle tant que des tickets du jour attendent. Si l'export d'une journée échoue sans
  cesse, les journées suivantes attendent (journalisé).
- Au plus 200 tickets `pending` examinés par passage, les plus anciennes participations d'abord.
- Une vente synchronisée en retard par une caisse hors ligne, après qu'une journée a été déclarée
  complète, laisse le ticket « introuvable » : l'équipe tranche.

## Questions à Splash360 (questions-en-attente n° 17) : toutes répondues

`ticket_id` imprimé en texte sur le ticket de caisse : oui. QR de borne = même `ticket_id` : oui.
Journée comptable coupée à 02:00 : oui. Pagination : annoncée à partir de 1, constatée à partir de 0 (migration 20261125120000) ; Splash360 a confirmé le 26/11 qu'elle reste à 0.
