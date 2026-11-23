# ADR 0018 — Branchement réel Splash360 : la caisse accepte la commande avant le paiement

Date : 2026-11-24 · Statut : acceptée

## Contexte

Splash360 a fourni son API Click & Collect (`docs/api-splash360/openapi-click-collect-1.0.0.json`,
analyse dans `analyse-api-click-collect.md`) et son CTO a précisé le parcours par message vocal le
23 novembre :

1. `GET /api/export/menus` : la carte ;
2. `POST /api/import/submitcommande` (statut `standby`) : la commande est déposée, un `ticketId` revient ;
3. `GET /api/export/cmdstatus/{ticketId}` interrogé environ chaque seconde jusqu'à « ready » :
   la caisse est prête à accepter la commande ; **c'est seulement là qu'on propose le paiement** ;
4. `POST /api/import/submitcmdpaiement/{ticketId}` après le paiement, puis nouvelle interrogation
   jusqu'à « confirmed » : la commande est intégrée en caisse ;
5. sans « ready » ou sans « confirmed », à nous de décider : annuler ou rembourser.

L'authentification est OAuth2 *client credentials* (`/oauth/v2/token`), vérifiée : sans jeton,
l'API répond 401 « OAuth2 authentication required ».

Le parcours existant (ADR 0010 et lot 5) déposait la commande **après** paiement : il ne convient plus.

## Décision

1. **Un seul client Splash360**, dans `packages/api-menu` (règle n° 5 élargie : ce paquet est le seul
   à parler à Splash360, carte et caisse) : jeton en cache jusqu'à 60 s avant expiration, nouvel essai
   sur 401, erreurs typées (`Splash360Error`, réessayable ou non). Identifiants lus dans
   l'environnement du serveur (`SPLASH360_CLIENT_ID`, `SPLASH360_CLIENT_SECRET`, `SPLASH360_API_URL`),
   jamais dans une application.
2. **Branchement par restaurant** (`restaurants.splash360_live`, faux par défaut) : vraie carte et
   vraie caisse seulement si le restaurant est branché **et** les identifiants posés ; sinon carte et
   caisse de démonstration, qui simulent le même parcours (en attente → prête → confirmée). Le
   propriétaire ou Splash360 branche depuis la page Paiement du back-office, avec un bouton
   « Tester la connexion » ; chaque action est journalisée.
3. **Poignée de main suivie sur la commande** (`orders.pos_*`, phases `waiting`, `ready`,
   `payment_sent`, `confirmed`, `failed`).
   - Paiement en ligne : l'application interroge `GET …/orders/:id/pos-readiness` chaque seconde.
     Le premier appel dépose la commande en caisse ; le serveur interroge Splash360 au plus une fois
     par seconde et par commande. `POST …/payment` est refusé (`pos_not_ready`) tant que la caisse
     n'a pas répondu « ready ». Au-delà de 60 s (`POS_READY_TIMEOUT_SECONDS`) ou en cas de refus :
     commande annulée, rien n'est débité.
   - Après le webhook Stripe vérifié (seul passage à « payée », inchangé) : l'envoi en caisse
     notifie le paiement (`carte`, montant, identifiant du paiement Stripe en détail) puis attend
     « confirmed ». Une attente n'est pas un échec : nouvel essai 15 s plus tard. Sans confirmation
     dans les 5 min (`POS_CONFIRM_TIMEOUT_SECONDS`) ou en cas de refus : **remboursement intégral
     automatique**, client prévenu, alerte au back-office.
   - Paiement sur place : l'envoi en caisse dépose la commande, attend « ready », notifie un
     paiement vide (`reglements: []`, prévu par la doc), attend « confirmed » ; en cas d'échec,
     commande annulée et client prévenu.
   - Une panne de Splash360 (réseau, 5xx) garde les nouveaux essais du lot 5 (1 min, 5 min, puis
     alerte) sans remboursement automatique : l'équipe décide.
4. **Traduction prudente** : seul ce qui est documenté est traduit (groupes → catégories, prix
   `prix_c`, `active`, `visible`, photo). Options et formules (`composition`, `steps`), prix par mode
   (`prixArray_c`), heure de retrait (aucun champ : envoyée en commentaire) et valeurs exactes des
   statuts restent des questions ouvertes (n° 16) ; la lecture des statuts est tolérante (casse,
   accents, synonymes, valeur inconnue = on attend).

## Conséquences

- Le client voit « Le restaurant prépare votre commande… » quelques secondes avant le paiement.
- Aucune commande d'essai ne part vers une caisse réelle tant qu'aucun restaurant n'est branché :
  le brancher est un acte explicite du back-office, à faire après confirmation par Splash360 d'une
  caisse de test.
- Sur Supabase Edge (recette), sans tâche de fond, la suite des envois avance au fil des requêtes
  (toutes les 10 s au plus) ; le serveur Node (production) garde sa tâche toutes les 15 s.
- Le retour des statuts par webhook signé (`/v1/pos/status`, lot 5) reste disponible si Splash360
  le propose ; la référence de caisse d'une commande est désormais son `ticketId`.
