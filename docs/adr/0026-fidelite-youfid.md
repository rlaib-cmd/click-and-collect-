# ADR 0026 — Fidélité réelle YouFID (« SPLASH FID POS API »)

- Statut : acceptée (lot 21, 25 novembre 2026)
- Remplace en partie : ADR 0009 (fidélité de démonstration), qui reste pour les enseignes sans
  compte YouFID, les tests et le développement local.
- Documentation de l'API : [docs/api-splash360/fidelite-youfid.md](../api-splash360/fidelite-youfid.md)

## Contexte

Splash360 a fourni le 25/11 la documentation de l'API fidélité YouFID (celle de la tablette en
magasin). Le club de l'application (inscription par SMS, carte VIP avec QR code, solde, cadeaux,
points des commandes, bonus ambassadeur) doit utiliser cette API pour les enseignes configurées,
derrière l'interface existante `LoyaltyProvider`. L'API n'a ni clé d'idempotence, ni historique
client, ni retrait de points, ni réglage « points par euro » lisible, et renvoie le PIN du client
en clair.

## Décisions

### Branchement par enseigne

- `packages/api-loyalty` contient le client (`youfid/client.ts`), le fournisseur
  (`youfid/provider.ts`) et un fournisseur d'aiguillage (`routing.ts`). Il reste le seul paquet à
  parler à l'API fidélité.
- Secrets dans l'environnement du serveur, jamais en base : `YOUFID_ACCOUNTS` = objet JSON indexé
  par sous-domaine d'enseigne → `{ "login", "password" }`, validé par zod au démarrage (erreur sans
  valeur citée). `merchant_id` vient de la réponse de connexion.
- Une enseigne absente de `YOUFID_ACCOUNTS` garde le fournisseur de `LOYALTY` (démonstration) ou
  aucune fidélité, comme avant. Le sous-domaine d'une enseigne est lu en base (cache 5 min).
- `YOUFID_BASE_URL` : défaut `https://api-loyalty.splash360.fr/dev/service/`, confirmée par
  Splash360 le 25/11 comme l'URL à utiliser (production comprise, jusqu'à nouvel ordre).

### Session et signature

- Une session par compte marchand et par instance du serveur, en mémoire. Connexion (route 1)
  avec un `device_id` stable par environnement (`YOUFID_DEVICE_ID`, défaut
  `splash360-commande-<APP_ENV>`) : clé propre, renouvelée 10 minutes avant son expiration
  (48 h). Plusieurs instances partagent le même `device_id` : YouFID renvoie la même clé tant
  qu'elle a moins de 24 h, et l'ancienne reste valable 10 min.
- Signature HMAC-SHA256 (clé = `session_key` décodée de l'hexadécimal) sur le corps exact envoyé
  + `merchant_id` + nonce (16 octets aléatoires) + timestamp ; en-tête
  `fid_client_id=…,nonce=…,timestamp=…,sign_algo=HMAC_SHA256,sign=…`. Pas de signature si
  `sec_type` = `none`.
- `ERR0401` (ou HTTP 401 sans code) : une seule réinitialisation et un seul nouvel essai, puis
  échec. Délai de 10 s par appel. Le statut est toujours lu dans le corps (`ok`, `ko`,
  `success`, `error`), quel que soit le statut HTTP.

### Routes utilisées

Consigne de Splash360 (26/11) : n'utiliser que les routes nécessaires. Le client
(`youfid/client.ts`) n'implémente que les routes **1, 2, 3, 5, 6, 7, 10 et 12** ; un test vérifie
qu'il n'en expose pas d'autre. La question de profil en attente, nécessaire à la route 12, est lue
sur la route 3 (`profile_question`, recherche par QR code) et non plus sur la route 11.

### Données personnelles

- Le PIN client (routes 3 et 5) est retiré à la lecture : les schémas ne le déclarent pas. Il
  n'est ni stocké, ni journalisé, ni renvoyé. Notre produit n'utilise pas de code PIN (décision du
  25/11) ; la route 13 n'est pas implémentée.
- Aucun corps de requête ou de réponse n'est journalisé ; journaux et registre ne contiennent que
  des identifiants techniques et des codes d'erreur.

### Membre, carte et inscription

- Identifiant de membre = `usr_id` YouFID (texte de chiffres). Les jetons de membre acceptent
  désormais un UUID (démonstration) ou cet identifiant numérique.
- Carte VIP : `cardCode` = `qr_code` YouFID.
- Table `loyalty_members_youfid` (`tenant_id`, `usr_id`, `qr_code`, téléphone E.164, e-mail et
  date de naissance saisis dans l'app, dates ; RLS, serveur uniquement) : YouFID ne retrouve un
  client que par QR code ou e-mail (route 3), le lien permet `getMember(usr_id)`. Elle est remplie
  à l'inscription, à la connexion par e-mail et par les recherches du back-office.
- Inscription par SMS : route 10 (client créé ou retrouvé), puis prénom et e-mail par la route 12,
  puis points de bienvenue par la route 5 (`forced_amount`, clé `welcome:<usr_id>`).
  `findByPhone` ne consulte que le lien local : la route 10 crée le client, elle n'est appelée
  qu'après acceptation des conditions. Un client déjà connu en magasin est retrouvé avec ses points
  (pas de prénom par défaut envoyé). **Décision du 26/11 au soir** : il reçoit aussi la bienvenue à
  sa première adhésion dans l'application de l'enseigne. La clé `welcome:<usr_id>` reste dans
  `loyalty_operations` après suppression du compte : une seule bienvenue par client et par enseigne.
- Inscription par e-mail seul : impossible chez YouFID (création par téléphone) ; refus clair, un
  compte existant reste retrouvé par son e-mail.

### Programme

- Paliers = `products` de la route 2 (id, coût, nom) ; les catégories offertes par palier (lot 16)
  restent réglées au back-office et suivent les identifiants YouFID.
- Points par euro et points de bienvenue : réglages de l'enseigne (`loyalty_program_settings`),
  modifiables au back-office. Défauts décidés le 25/11 : **1 point par euro (décision du 26/11, au lieu de 10), 100 points de
  bienvenue**. **Décision du 26/11** : le gain d'une commande en ligne est calculé par notre règle
  (montant payé × points par euro, 1 par défaut) et envoyé en crédit forcé (`forced_amount`, prioritaire chez
  YouFID) : le gain annoncé est le gain crédité. Constaté en recette : avec `amount` = 1,00 €,
  YouFID créditait 0 point (règle du marchand différente). En caisse, la règle YouFID s'applique.

### Commande payée : exactement une fois

- Ordre : cadeau (route 6, après contrôle du solde par la route 3), puis gain (route 5 avec
  `forced_amount` = points de notre règle, décision du 26/11 ; plus d'envoi de `amount`). Pas
  d'appel quand le gain est nul (YouFID créditerait les points fixes de passage).
- Registre `loyalty_operations` (`tenant_id`, clé unique `order:<id>:redeem|earn`,
  `welcome:<usr_id>`, `ambassador:<participation>`, `adjust:<uuid>` ; type, points, libellé,
  statut, code d'erreur, points crédités, essais ; RLS serveur). Avant l'appel, la clé est
  réservée par insertion conditionnelle ; après, l'issue est notée :
  - `done` : appliquée ; un rejeu ne rappelle pas YouFID ;
  - `failed` : refus certain (statut `error`, solde insuffisant, `maximum_scans_reached`) ;
    l'opération peut être reprise par un nouvel essai ;
  - `uncertain` : coupure réseau, délai dépassé ou réponse illisible **après envoi** ; jamais
    rejouée seule, journalisée et listée au back-office (« Opérations à vérifier ») ;
  - une réservation restée `pending` plus de 2 minutes (serveur arrêté pendant l'appel) devient
    `uncertain` ; un appel concurrent sur une réservation récente répond « en cours » ;
  - `resolved` : marquée vérifiée par l'équipe après contrôle chez YouFID.
- **Risque résiduel** : sans clé d'idempotence côté YouFID, une opération `uncertain` a pu être
  appliquée ou non. On préfère un crédit manquant (corrigé à la main) à un double crédit : rien
  n'est renvoyé automatiquement. Une panne de notre base entre l'appel et la note de l'issue
  laisse l'opération `pending`, donc `uncertain` : même traitement.

### Corrections et bonus

- `adjustPoints` : route 5 avec `forced_amount`, positif seulement ; un retrait renvoie
  « non pris en charge par YouFID » au back-office. Le bonus ambassadeur passe la clé
  `ambassador:<participation>` : un rejeu ne crédite pas deux fois.
- `maximum_scans_reached` : échec visible (registre, journal, message au back-office, motif dans
  l'historique de la participation ambassadeur), jamais ignoré.

### Historique et back-office

- Pas de route d'historique : l'historique du membre est le registre local (opérations
  appliquées), présenté comme « mouvements faits dans l'application » (`historyScope: "app"`).
- Back-office : liste des membres (liens locaux ; recherche par nom ou e-mail via la route 7, par
  téléphone dans les liens locaux), solde et QR code lus chez YouFID, règles de points,
  opérations à vérifier avec badge et action « Marquer comme vérifiée ».
- Suppression RGPD : seul le lien local est effacé ; l'effacement chez YouFID se demande à
  Splash360 (pas de route).
- Diagnostic super-administrateur : `POST /v1/admin/tenants/:id/youfid/test` (connexion + route 2)
  renvoie `{ ok, merchantId, rewards, secType }`, sans secret ; bouton « Tester YouFID » dans la
  liste des enseignes.

### Hors périmètre

- Bons de réduction (routes 14 et 15) et consentement SMS (route 11) : non implémentés. Splash360
  a demandé (26/11) de n'utiliser que les routes nécessaires, certaines étant réservées au
  marchand ; les fonctions du client écrites au lot 21 ont été retirées.
- Remboursement d'une commande : pas de retrait de points possible chez YouFID.

## Conséquences

- Les enseignes configurées utilisent leurs vrais clients YouFID : en recette, un compte marchand
  réel crédite de vrais clients (compte de test demandé à Splash360).
- Hypothèses à confirmer (voir `questions-en-attente.md`, section YouFID) : format du téléphone
  envoyé à la route 10 (national `06…` retenu), identifiant de question attendu par la route 12
  (id de la question en attente si son type correspond, sinon 0), format de `BIRTH`
  (AAAA-MM-JJ), détection d'un nouveau client (absence de `phone` à la route 10), montant envoyé
  (total payé, frais compris).

## Réponses du 26/11 (directeur technique de Splash360)

Réponses faisant foi, appliquées le 26/11 :

1. **Téléphone en E.164** (`+33612345678`) pour la route 10 (et le champ `phone` de la route 5,
   que l'application n'envoie pas) : YouFID compare les chaînes, le format national `06…` créerait
   un doublon d'un client connu en magasin. L'option `phoneFormat` du client est retirée ; le
   lien local reste consulté d'abord (`findByPhone`), un membre déjà lié n'appelle pas la route 10.
   Route 10 en erreur « Duplicated user » : `LoyaltyDuplicateCustomerError`, journal technique,
   entrée `loyalty.youfid_duplicate_user` au journal du back-office (sans téléphone), message
   générique au client (`loyalty_unavailable`).
2. **Route 5, champ `code`** (avec `status` = ok et `won_pts` = « 0 ») :
   `MAX_POINTS_REACHED` (plafond de solde ; `maximum_scans_reached` absent) → refus
   `balance_cap`, « Plafond de solde YouFID atteint » dans « Opérations à vérifier », jamais
   renvoyé automatiquement ; `MAX_SCAN_REACHED` (`maximum_scans_reached` = « 1 ») →
   `daily_limit` ; `AMOUNT_TOO_HIGH` → refus `amount_too_high` ; `code` vide = succès. Le filet
   `not_credited` (0 point sans code) est gardé.
3. **Gain d'une commande** : `forced_amount` (fait foi pour les points) **et** `amount` (euros
   exacts, calculés depuis les centimes) pour les statistiques du marchand. Bienvenue, bonus et
   corrections : `forced_amount` seul.
4. **Route 6** : erreur générique `{"status":"error","message":"Error: Problem during
   withdrawPoints on LOYALTY"}` → refus `redeem_failed` (solde contrôlé avant par la route 3).
5. **Les points n'expirent pas** : `loyalty_program.validity` n'est ni renvoyé ni affiché (test).
6. **`qr_code` est un texte** (8 chiffres commençant par 1 pour un compte créé par téléphone) :
   lu et envoyé en texte, jamais converti en nombre.
7. **Effacement RGPD** : demandé par e-mail à YouFID par l'enseigne, sous un mois au plus
   (ADR 0028).

Décisions du propriétaire (26/11), sans changement de code :

- **Historique des points du client** (passages et cadeaux, en magasin compris) : route demandée à
  Splash360 sous 4 semaines, au plus tard le **24/12/2026**. D'ici là, l'historique reste celui
  des opérations faites par l'application.
- **Corrections serveur** : la faille de la route 13 (PIN de n'importe quel client) est demandée
  en urgence, sous quelques jours ; les routes 15 (compteur du bon) et 12 (`FEMALE`) ne sont pas
  urgentes, l'application ne les utilise pas.

Reste ouvert : valeur du plafond de solde du marchand 2 (`questions-en-attente.md`, Y19).

