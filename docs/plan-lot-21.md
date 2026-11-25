# Lot 21 — Fidélité réelle YouFID (« SPLASH FID POS API »)

**Demande** (25 novembre, propriétaire) : remplacer la fidélité de démonstration par l'API
fidélité YouFID de Splash360 pour les enseignes configurées, derrière `LoyaltyProvider`, sans
retirer la démonstration (tests, développement, enseignes sans YouFID). Décisions : ADR 0026.
Documentation de l'API : `docs/api-splash360/fidelite-youfid.md`.

Décisions du propriétaire (25/11) : 10 points par euro et 100 points de bienvenue par défaut,
modifiables par enseigne ; aucun code PIN dans notre produit ; secret `YOUFID_ACCOUNTS` indexé par
sous-domaine (`chickenstreet`), posé en recette par le propriétaire ; URL de l'API confirmée.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Client YouFID (`packages/api-loyalty/src/youfid/client.ts`) : connexion (route 1, `device_id`), session en mémoire renouvelée avant expiration, signature HMAC-SHA256 du corps exact, nonce unique, réinitialisation unique sur `ERR0401`, statut lu dans le corps (`ok`, `ko`, `success`, `error`), délai 10 s ; routes 2, 3, 5, 6, 7, 10, 11, 12, 14, 15 ; PIN retiré à la lecture ; montants en euros exacts depuis les centimes |
| 2 | Fournisseur YouFID (`youfid/provider.ts`) : programme (route 2 + réglages), inscription par SMS (route 10, profil route 12, bienvenue route 5), membre par lien local + route 3, profil, commande payée (route 6 puis route 5), bonus et corrections (`forced_amount`, positif seulement), historique local, recherche au back-office (route 7) |
| 3 | Aiguillage par enseigne (`routing.ts`, `apps/api/src/loyalty/youfid.ts`) : YouFID pour les sous-domaines de `YOUFID_ACCOUNTS`, démonstration ou rien pour les autres ; diagnostic par enseigne |
| 4 | Migration `20261126000000_loyalty_youfid.sql` : `loyalty_members_youfid`, `loyalty_operations` (clé unique : exactement une fois), `loyalty_program_settings` (défauts 10 et 100) ; RLS, accès serveur ; magasin Postgres `createPostgresYoufidStore` |
| 5 | API : jetons de membre acceptant l'identifiant YouFID numérique ; montant payé transmis au règlement ; inscription par e-mail seul refusée clairement ; bonus ambassadeur avec clé d'opération et motif d'échec ; erreurs d'ajustement explicites (retrait non pris en charge, passages du jour atteints, YouFID indisponible) ; code d'erreur `loyalty_unavailable` |
| 6 | Back-office : `GET/PUT /v1/admin/loyalty/settings`, `GET /v1/admin/loyalty/operations`, `POST /v1/admin/loyalty/operations/:id/resolve`, `POST /v1/admin/tenants/:id/youfid/test` (super-administrateur) ; page Fidélité (données YouFID en direct, règles de points, opérations à vérifier avec badge) ; bouton « Tester YouFID » dans les enseignes |
| 7 | Application : historique présenté comme « mouvements faits dans l'application » (`historyScope: "app"`) ; carte VIP = QR code YouFID |
| 8 | Serveur Node et fonction Edge branchés (`YOUFID_ACCOUNTS`, `YOUFID_BASE_URL`, `YOUFID_DEVICE_ID`) |

## Vérifications

- Tests du client avec un faux serveur YouFID (fetch injecté, qui vérifie lui-même signature,
  nonce, horodatage et `merchant_id`) : vecteur de signature calculé hors du code, décodage de la
  clé, format de l'en-tête, nonces uniques, nonce rejoué refusé, `ERR0401` → une réinitialisation,
  renouvellement avant expiration, connexion refusée sans secret dans le message, erreurs en
  HTTP 200 et 400, routes « success », PIN absent des objets, montants exacts, crédit forcé,
  téléphone national, recherche, consentement, bons, panne et réponse illisible.
- Tests du fournisseur : programme et réglages, inscription (nouveau client, client connu en
  magasin, e-mail seul), profil, commande payée une seule fois, appels simultanés, solde
  insuffisant puis reprise, coupure après envoi → « à vérifier » sans nouvel envoi, serveur arrêté
  pendant l'appel → « à vérifier », refus → reprise, `maximum_scans_reached`, bonus ambassadeur
  une seule fois, retrait refusé, recherche au back-office, PIN absent des sorties et du journal,
  aiguillage par enseigne, configuration `YOUFID_ACCOUNTS` (erreurs sans secret), `device_id`.
- Routes (`apps/api/src/routes/youfid.test.ts`) : inscription par SMS jusqu'à la carte VIP,
  commande payée (cadeau + gain, webhook rejoué), back-office (recherche, réglages, retrait refusé,
  passages atteints, opération à vérifier puis vérifiée), diagnostic réservé au super-administrateur.
- Postgres : `loyalty-youfid.integration.test.ts` (lien, réservation concurrente, reprise d'un
  refus, opération interrompue, réglages) ; pgTAP `loyalty_youfid_test.sql`.
- Aucun appel réel à YouFID dans les tests ; aucun identifiant dans le dépôt.

## Ce qui reste

- Réponses de Splash360 (questions Y3 à Y18 de `questions-en-attente.md`), en particulier
  l'idempotence de la route 5, la limite de passages par jour, le format du téléphone et un
  compte marchand de test.
- Bons de réduction au paiement (routes 14 et 15) et consentement SMS (route 11) : fonctions
  prêtes, parcours à construire.
- Remboursement d'une commande : pas de retrait de points possible chez YouFID.
