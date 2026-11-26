# Lot 20 — « Achat vérifié » : ticket identifié par son `ticket_id` et vérifié dans les ventes Splash360

**Demande** (25 novembre, propriétaire) : les tickets de caisse Splash360 n'ont pas de QR code, et le
QR des tickets de borne sert à payer au comptoir (il ne prouve pas le paiement). Le client
photographie son ticket, l'IA en lit l'identifiant (`ticket_id`, imprimé en texte), et on vérifie
dans l'export des ventes Splash360 que la commande a été payée avant de créditer les points de la
story. Le QR de borne encode le même `ticket_id` : il est vérifié de la même façon. Décisions :
ADR 0025.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Lecture de l'export des ventes (`packages/api-menu`, `readSalesPage`) : enveloppe stricte, ventes lues une à une, `ticket_id` UUID en minuscules, total en centimes (`Math.round(total × 100)`) ; pagination à partir de 0 (constaté le 25/11, confirmé le 26/11) |
| 2 | Migrations `20261125100000_ambassador_ticket_photo.sql` puis `20261125110000_ambassador_ticket_id.sql` : `ticket_check`, `ticket_id`, `ticket_date`, `ticket_time`, `ticket_total_cents` sur les participations ; événements `ticket_read` et `ticket_checked` ; tables `pos_sales` et `pos_sales_sync` (`tenant_id`, RLS, accès serveur) |
| 3 | Journée comptable (`business-day.ts`) : coupure à 02:00 heure de Paris (`BUSINESS_DAY_CUTOFF`), changements d'heure compris |
| 4 | Lecture du ticket par Claude (`ticket-read.ts`) : disposition réelle d'un ticket Splash360 dans les consignes (UUID sous le « #numéro », jamais la référence NF525 « Ticket : T… »), UUID strict côté serveur avec correction O→0 / I,l→1 seulement si le résultat est un UUID ; photo jamais conservée |
| 5 | `POST /v1/tenants/:s/ambassador/ticket-photo` : jeton signé 30 min (enseigne + membre), journée comptable de 7 jours au plus ; participation avec `ticketPhoto` ou QR de borne contenant un UUID : référence = `ticket_id` en majuscules, ticket « à vérifier » |
| 6 | Vérification périodique (`ticket-check.ts`) : une page de l'export par passage, journée la plus ancienne d'abord, 429 sauté ; rapprochement par `ticket_id` → vérifié, impayé (refus automatique) ou introuvable (à vérifier) |
| 7 | Crédit automatique bloqué tant que le ticket est à vérifier, introuvable ou impayé |
| 8 | Application : « Prendre mon ticket en photo », identifiant raccourci, date, heure et montant à confirmer, repli sur la saisie ; historique « Achat vérifié » / « Vérification du ticket en cours » / « Ticket introuvable » |
| 9 | Back-office : état de la vérification, identifiant raccourci et données lues, nouveaux événements dans l'historique |

## Vérifications

- Tests : export des ventes (centimes exacts, identifiant non UUID ignoré, enveloppe inconnue,
  page 0 par défaut), journée comptable (01:59 / 02:00, heure d'été, heure d'hiver, passages à
  l'heure d'été et d'hiver), lecture du ticket avec un client Claude simulé (lisible, heure et total
  facultatifs, UUID invalide, injection, refus, panne, sans clé, consignes « jamais Ticket : T… »),
  UUID strict et corrections O/I/l, jeton, fenêtre de 7 jours en journée comptable, QR de borne,
  rapprochement (vérifié, impayé, introuvable, total différent, vente copiée un autre jour, heure
  illisible, QR, journée terminée à 02:00, relecture complète), une page par passage, 429, sans
  accès aux ventes, passages simultanés, routes (`ambassador-ticket.test.ts`) et crédit jamais
  automatique tant que le ticket n'est pas vérifié.
- Postgres : `ambassador.integration.test.ts` et `pos-sales.integration.test.ts` ; pgTAP
  `ambassador_ticket_photo_test.sql`.
- Aucun appel réel à Claude ni à Splash360 dans les tests ; aucun identifiant réel dans le dépôt.

## Ce qui reste

1. Recette puis production : migration `20261125110000_ambassador_ticket_id.sql` (la `100000` est
   déjà en recette), puis fonction `api`. Aucune nouvelle variable : `ANTHROPIC_API_KEY` (lecture)
   et les identifiants Splash360 existants (export des ventes) ; restaurant branché
   (`splash360_live`) requis pour vérifier.
2. Essai en recette avec un vrai ticket Chicken Street (photo et QR de borne).
3. Version installée (iOS, Android) : la photo du ticket attend le même module natif que la photo
   du produit (nouveau build EAS) ; en attendant, QR et saisie.
