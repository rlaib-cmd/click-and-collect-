# Lot 14 — Branchement réel Splash360 (carte et caisse)

**Demande** (23 novembre) : « fais le boulot pour finir l'application côté Splash », d'après la
documentation Click & Collect de Splash360 et le message vocal de son CTO (parcours : carte →
commande en attente → caisse « ready » → paiement → caisse « confirmed »). Décisions : ADR 0018.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Client Splash360 (`packages/api-menu/src/splash360`) : OAuth2 client credentials, carte, dépôt de commande, statut, paiement ; traduction de la carte ; lecture tolérante des statuts |
| 2 | Base : `restaurants.splash360_live`, colonnes `orders.pos_*` (ticket et phases), `PosTicketStore` ; tests pgTAP et d'intégration Postgres |
| 3 | API : route `GET /v1/tenants/:s/orders/:id/pos-readiness`, paiement refusé tant que la caisse n'est pas prête, envoi du paiement puis attente de la confirmation, annulation ou remboursement automatique ; caisse de démonstration au même parcours ; choix réel/démo par restaurant |
| 4 | Application : écran « Le restaurant prépare votre commande… » avant la feuille de paiement, message clair si la caisse refuse |
| 5 | Back-office : section « Caisse Splash360 » de la page Paiement (branché/démonstration, Tester la connexion, Brancher la caisse) ; état caisse sur chaque commande |
| 6 | Documentation : ADR 0018, analyse de l'API, questions en attente, mise en production |

## Ce qu'il reste à faire hors code

1. Poser les secrets du serveur (recette : Supabase → Edge Functions → Secrets) :
   `SPLASH360_CLIENT_ID`, `SPLASH360_CLIENT_SECRET` (et `SPLASH360_API_URL` si différent de
   `https://api.splash360.fr`). Ne jamais les mettre dans le dépôt ni dans le chat.
2. Faire confirmer par Splash360 une **caisse de test** (questions n° 16), puis, au back-office :
   Paiement → Caisse Splash360 → « Tester la connexion » → « Brancher la caisse » sur ce seul restaurant.
3. Une fois la vraie carte reçue : compléter la traduction des options et formules quand Splash360
   aura documenté `composition` et `steps`.

## Tests

- `packages/api-menu` : client (jeton, cache, 401, erreurs, ticket), carte, statuts.
- `apps/api` : poignée de main (attente, rythme d'interrogation, délai, refus, caisse injoignable,
  pas de dépôt sans paiement possible), après paiement (confirmation, attente, remboursement),
  traduction de commande, back-office (droits, branchement, test de connexion).
- `packages/db` : `PosTicketStore` sur Postgres ; `supabase/tests/splash360_pos_test.sql`.
