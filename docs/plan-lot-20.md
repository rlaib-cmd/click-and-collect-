# Lot 20 — « Achat vérifié » : ticket de caisse photographié et vérifié dans les ventes Splash360

**Demande** (25 novembre, propriétaire) : les tickets de caisse Splash360 n'ont pas de QR code, et le
QR des tickets de borne sert à payer au comptoir (il ne prouve pas le paiement). Le client
photographie son ticket, l'IA en lit le numéro, et on vérifie auprès de Splash360 que la commande a
été payée avant de créditer les points de la story. Décisions : ADR 0025.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Lecture de l'export des ventes (`packages/api-menu`, `readSalesPage`) : enveloppe stricte, ventes lues une à une, total en centimes (`Math.round(total × 100)`), numéro normalisé |
| 2 | Migration `20261125100000_ambassador_ticket_photo.sql` : `ticket_check`, `ticket_date`, `ticket_number`, `ticket_total_cents` sur les participations ; événements `ticket_read` et `ticket_checked` ; tables `pos_sales` et `pos_sales_sync` (`tenant_id`, RLS, accès serveur) |
| 3 | Lecture du ticket par Claude (`ticket-read.ts`) : sortie structurée, contrôle serveur de chaque champ, illisible sur refus ou panne, lecture manuelle sans clé ; photo jamais conservée |
| 4 | `POST /v1/tenants/:s/ambassador/ticket-photo` : jeton signé 30 min (enseigne + membre), ticket de 7 jours au plus ; participation avec `ticketPhoto`, référence `AAAAMMJJ-NUMERO-TOTAL` déduite par le serveur, ticket « à vérifier » |
| 5 | Vérification périodique (`ticket-check.ts`) : une page de l'export par passage, journée la plus ancienne d'abord, 429 sauté ; rapprochement journée + numéro + total + restaurant branché → vérifié, impayé (refus automatique) ou introuvable (à vérifier) |
| 6 | Crédit automatique bloqué tant que le ticket est à vérifier, introuvable ou impayé |
| 7 | Application : « Prendre mon ticket en photo », données lues à confirmer, repli sur la saisie ; historique « Achat vérifié » / « Vérification du ticket en cours » / « Ticket introuvable » |
| 8 | Back-office : état de la vérification et données lues sur chaque participation, nouveaux événements dans l'historique |

## Vérifications

- Tests : lecture de l'export (centimes exacts, vente illisible ignorée, enveloppe inconnue), lecture
  du ticket avec un client Claude simulé (lisible, illisible, refus, panne, sans clé), jeton (signature,
  expiration, enseigne, membre, distinct du jeton photo), fenêtre de 7 jours à l'heure de Paris,
  référence déduite, rapprochement (vérifié, impayé, introuvable, journée en cours, relecture
  complète), une page par passage, 429, sans accès aux ventes, deux passages simultanés, routes
  (`ambassador-ticket.test.ts`) et crédit jamais automatique tant que le ticket n'est pas vérifié.
- Postgres : `ambassador.integration.test.ts` (ticket photographié, rapprochement conditionnel,
  refus, à vérifier) et `pos-sales.integration.test.ts` ; pgTAP `ambassador_ticket_photo_test.sql`.
- Aucun appel réel à Claude ni à Splash360 dans les tests.

## Ce qui reste

1. Relever **un vrai ticket de caisse** Chicken Street : le numéro imprimé est-il `numero` de
   l'export ? Le total imprimé est-il `total` ? (questions-en-attente n° 17).
2. Recette puis production : migration `20261125100000_ambassador_ticket_photo.sql`, puis fonction
   `api`. Aucune nouvelle variable : `ANTHROPIC_API_KEY` (lecture) et les identifiants Splash360
   existants (export des ventes) ; restaurant branché (`splash360_live`) requis pour vérifier.
3. Version installée (iOS, Android) : la photo du ticket attend le même module natif que la photo
   du produit (nouveau build EAS) ; en attendant, QR et saisie.
