# API fidélité YouFID — « SPLASH FID POS API »

Transcription du document « SPLASH FID POS API » (Splash360, 25 novembre 2026, 15 pages), reçu le
25/11 pour le lot 21. Aucun identifiant, mot de passe ni donnée client réelle n'est repris ici.
L'analyse pour la commande en ligne (correspondance avec `LoyaltyProvider`) est en fin de
document ; les décisions sont dans l'[ADR 0026](../adr/0026-fidelite-youfid.md).

## Objectif et sécurité

Ces web services sont ceux de l'application tablette YouFID : ils permettent à un système tiers
(borne, caisse) d'intégrer la fidélité YouFID. Le document s'adresse aux développeurs et
intégrateurs.

Toutes les requêtes passent en HTTPS et sont signées selon OAuth v1.0a. À l'initialisation de la
tablette, le marchand saisit son login et son mot de passe : le serveur l'authentifie et renvoie
une clé de session (`session_key`). Chaque requête suivante est signée avec cette clé.

Une requête authentifiée porte un en-tête `Authorization` : des paires `clé=valeur` séparées par
des virgules.

| Clé | Contenu |
|---|---|
| `fid_client_id` | Identifiant unique du marchand |
| `nonce` | Valeur unique par requête et par timestamp |
| `timestamp` | Horodatage de la requête (timestamp Unix) |
| `sign_algo` | Algorithme de signature de la requête |
| `sign` | Signature de la requête |

Exemple (tel que dans le document v1.0) :

```
Authorization: fid_client_id=123456,nonce=2322344,timestamp=1549973079,sign_algo=HMAC_SHA1,sign=xxxxxxxxxyyy
```

Toutes les routes sont en `POST {{base_url}}/<route>.php`, avec les en-têtes `Authorization`,
`Content-Type: application/json` et `Accept: application/json`. Une erreur renvoie toujours
`{"status": "error", "message": "…"}`.

### Calcul de la signature

Le serveur calcule toujours un HMAC-SHA256 en hexadécimal, quel que soit `sign_algo` (la borne
envoie `HMAC_SHA256`).

1. Clé : `session_key` décodée de l'hexadécimal. Elle fait 128 caractères hexadécimaux, soit 64
   caractères alphanumériques une fois décodée.
2. Données signées : corps brut de la requête + `fid_client_id` + `nonce` + `timestamp`,
   concaténés sans séparateur. Pour un GET, la query string suit le corps.
3. `sign` = HMAC-SHA256(données, clé), en hexadécimal.

Le corps signé doit être exactement celui envoyé, au caractère près.

| Contrôle | Règle |
|---|---|
| Horodatage | Écart maximal de ±300 s avec l'horloge du serveur |
| Nonce | Usage unique par marchand : un nonce rejoué est refusé |
| Marchand | `fid_client_id` doit être le `merchant_id` du corps |
| Refus | HTTP 200 avec `{"status": "error", "message": "Not authorized", "code": "ERR0401"}` |

### Clés de session

Si `marchandInitMarchand.php` reçoit un `device_id`, l'appareil obtient sa propre clé, qui expire
48 h après sa création. Une nouvelle initialisation renvoie la même clé tant qu'elle a moins de
24 h, puis une nouvelle. L'ancienne clé reste valable 10 minutes. Sans `device_id`, tous les
appareils du marchand partagent une clé fixe, qui n'expire pas.

L'application doit se réinitialiser avant `session_key_expires_at`, ou dès qu'elle reçoit un
`ERR0401`.

La signature n'est exigée que pour les marchands dont `sec_type` vaut `oauth1HmacSha256`. Les
routes clients (voir le récapitulatif) la vérifient toujours pour ces marchands.
`marchandInitMarchand.php` n'est jamais signée.

## Récapitulatif des routes

L'API compte 15 routes : les 9 de la v1.0 et 6 nouvelles, autour du client identifié par téléphone
et des bons de réduction. La borne utilise 13 de ces routes, la caisse 6. L'URL de base utilisée
par la borne est `https://api-loyalty.splash360.fr/dev/service/`.

| # | Route | Rôle | Version | Signature (marchand sécurisé) | Utilisée par |
|---|---|---|---|---|---|
| 1 | `marchandInitMarchand.php` | Connexion du marchand, clé de session | v1.0, complétée | Jamais | Borne, caisse |
| 2 | `marchandGetMerchantDetailsV2.php` | Détails du marchand et cadeaux | Remplace `marchandGetMarchandDetails.php` | Exigée | Borne |
| 3 | `testmarchandCheckScanUserIfExistsV2.php` | Recherche d'un client par QR code ou e-mail | v1.0, nom et réponse corrigés | Exigée | Borne |
| 4 | `testmarchandGetAnswerV2.php` | Réponse à l'enquête de satisfaction | v1.0 | Selon le mode du serveur | Aucune |
| 5 | `marchandCheckScanUser.php` | Passage du client, gain de points, inscription | v1.0, champs corrigés | Exigée | Borne, caisse |
| 6 | `transformToPresent.php` | Points transformés en cadeau | v1.0 | Exigée | Borne, caisse |
| 7 | `marchandListUsersV2.php` | Recherche de clients par nom ou e-mail | v1.0 | Exigée | Borne |
| 8 | `marchandSynchScan.php` | Synchronisation des scans hors ligne | v1.0 | Exigée | Borne |
| 9 | `marchandUserPromoV2.php` | Utilisation d'une promotion | v1.0 | Selon le mode du serveur | Aucune |
| 10 | `registerCustomerByPhone.php` | Identification ou inscription par téléphone | Nouvelle | Exigée | Borne, caisse |
| 11 | `customerGetOrUpdateSmsOptin.php` | Lecture ou mise à jour du consentement SMS | Nouvelle | Exigée | Borne |
| 12 | `customerSubmitResponse.php` | Réponse à une question de profil | Nouvelle | Exigée | Borne |
| 13 | `customerDeleteOrUpdatePinCode.php` | Création ou suppression du code PIN client | Nouvelle | Exigée | Borne |
| 14 | `checkCustomerVoucher.php` | Vérification d'un bon de réduction | Nouvelle | Exigée | Borne, caisse |
| 15 | `burnCustomerVoucher.php` | Utilisation d'un bon de réduction | Nouvelle | Exigée | Borne, caisse |

« Exigée » : toute requête non signée est refusée (`ERR0401`) si le marchand a `sec_type` =
`oauth1HmacSha256`. « Selon le mode du serveur » : la signature n'est exigée que si le serveur
tourne en mode `enforce`.

## Routes 1 à 9 (v1.0, mises à jour)

Les routes 1, 2, 3, 5 et 7 ont été vérifiées dans le code du serveur, et leurs champs corrigés.
Les routes 4, 6, 8 et 9 reprennent la v1.0.

### 1. Initialisation marchand

`POST {{base_url}}/marchandInitMarchand.php` : authentifie le marchand et renvoie la clé de
session. Cette requête n'est pas signée.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `login` | string | oui | Login du marchand |
| `password` | string | oui | Mot de passe |
| `device_id` | string | non (nouveau) | Identifiant stable de l'appareil, 100 caractères au plus : donne une clé propre à l'appareil |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `message` | string | Message d'erreur, vide en cas de succès |
| `merchant_id` | integer | Identifiant du marchand |
| `loyalty_mode` | string | `0` standard ; `1` et `2` : modes propres à certains marchands |
| `sec_type` | string | `none` ou `oauth1HmacSha256` |
| `session_key` | string | Clé de session en hexadécimal, si `sec_type` = `oauth1HmacSha256` |
| `session_key_expires_at` | string | Expiration de la clé d'appareil (UTC, ISO 8601) |
| `session_key_expires_in` | integer | Secondes restantes avant expiration |

Les champs `name`, `logo`, `application_id`, `pin_code` et `is_acceuil_client` de la v1.0 ne sont
plus renvoyés. Le nom, le logo et le PIN sont dans la route 2.

### 2. Détails marchand

`POST {{base_url}}/marchandGetMerchantDetailsV2.php` : remplace `marchandGetMarchandDetails.php`,
qui n'existe pas sur le serveur.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `name` | string | Nom du marchand |
| `logo` | string | URL du logo |
| `address` | string | « adresse, code postal, ville » |
| `attribution_pts` | string | `1` : points au montant ; `0` : points au passage |
| `pin` | string | Code PIN marchand |
| `is_pin_marchand` | string | `1` si le PIN marchand est actif (nouveau) |
| `is_promo` | string | `0` ou `1` |
| `survey_desk` | string | Même valeur que `is_promo` |
| `is_desk` | integer | `1` si le marchand a un comptoir, absent sinon |
| `categories` | array | Si `is_desk` = 1 : `category_id`, `name`, `products` (`product_id`, `name`) |
| `img_adv_1` … `img_adv_10` | string | URL des visuels publicitaires |
| `products` | array | Cadeaux, du moins cher au plus cher : `id`, `cost`, `name`, `type` |
| `loyalty_program` | object | Si le marchand en a un : `id`, `name`, `program_type`, `validity` (durée de validité des points) |
| `code` | string | En cas d'erreur : `ERR0404` (paramètre manquant ou marchand inconnu), `ERR0401` |

### 3. Recherche d'un client

`POST {{base_url}}/testmarchandCheckScanUserIfExistsV2.php` : la v1.0 l'appelait
`testmarchandCheckScanUserIfExistV2.php`, sans le « s ». Elle cherche le client par QR code ou par
e-mail.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `qr_code` | string | l'un des deux | QR code du client |
| `email` | string | l'un des deux | E-mail du client (nouveau) |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` si le client existe, `ko` sinon |
| `is_user` | integer | `1` si le client existe, `0` sinon |
| `ask_phone` | integer | `1` : demander le téléphone ; `0` : déjà connu |
| `promo` | integer ou object | `0`, ou la promotion en cours |
| `survey` | integer ou object | `0`, ou une question : `id`, `question`, et `marchandName`, `marchandId` pour un groupe |
| `questions` | integer | Toujours `0` |
| `usr_id` | integer | Identifiant du client |
| `qr_code`, `nom`, `prenom`, `phone` | string | Identité du client |
| `is_pin_active` | boolean | Le client a un code PIN |
| `pin_code` | string | Code PIN du client |
| `sms_optin` | boolean ou null | Consentement SMS chez ce marchand, `null` si jamais demandé |
| `profile_question` | object | Prochaine question de profil à poser : `id`, `type`, `name`, `label`, `rank` |
| `total_points` | integer | Solde de points |
| `gifts` | array | Cadeaux accessibles avec ce solde : `id`, `nom`, `cout`, `photo` |
| `gift`, `last_gift_id` | object, integer | À la place de `gifts` pour un programme de type `DOMINOS` : prochain cadeau atteint (`id`, `name`, `cost`, `type`) et dernier cadeau reçu |

### 4. Réponse à l'enquête de satisfaction

`POST {{base_url}}/testmarchandGetAnswerV2.php` : la v1.0 la titrait par erreur « Vérification
de l'existence d'un utilisateur ».

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `qr_code` | integer | oui | QR code du client |
| `answer` | object | oui | Réponse : `survey` (identifiant de la question), `note`, `marchandId` (marchand concerné), `comment` (optionnel) |

Réponse : `status` = `ok`.

### 5. Passage client

`POST {{base_url}}/marchandCheckScanUser.php` : enregistre un passage, crédite les points et peut
inscrire le client.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `qr_code` | string | oui | QR code du client |
| `is_register` | integer | non | `1` : nouveau client (`email` et `qr_code` requis) |
| `email` | string | si `is_register` = 1 | E-mail du client |
| `phone` | string | non | Téléphone du client |
| `usr_id` | integer | non | Identifiant du client (`user_id` dans la v1.0) |
| `amount` | decimal | non | Montant de la commande (`montant` dans la v1.0) |
| `forced_amount` | integer | non | Nombre de points à créditer tel quel (nouveau) |
| `optout` | integer | non | `1` : refuse la newsletter ; `0` : l'accepte |

Points crédités, par ordre de priorité :

1. `forced_amount` s'il est fourni.
2. Les points fixes par passage du marchand, si ses points sont « au passage ».
3. Les points calculés sur `amount`. Au-delà de 4 000, aucun point n'est crédité.
4. Sinon, les points fixes par passage (5 par défaut).

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `usr_id` | integer | Identifiant du client (`user_id` dans la v1.0) |
| `last_name`, `first_name` | string | Nom, prénom |
| `fid_status` | string | Statut de fidélité |
| `won_pts` | integer | Points gagnés (`wont_pts` dans la v1.0) |
| `total_pts` | integer | Solde de points |
| `maximum_scans_reached` | string | `1` si le nombre de scans par jour est atteint |
| `pin_user` | string | PIN du client |
| `ask_phone` | integer | `1` : demander le téléphone |
| `code`, `message` | string | Code et message d'erreur |

### 6. Transformation de points en cadeau

`POST {{base_url}}/transformToPresent.php`

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `usr_id` | integer | oui | Identifiant du client |
| `products` | array | oui | Cadeaux : `id` (requis), `cost` (requis), `name` (optionnel) |

Réponse : `status`, et `total_pts`, le solde restant.

### 7. Recherche de clients

`POST {{base_url}}/marchandListUsersV2.php` : recherche sur le nom, le prénom et l'e-mail.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `usr_input` | string | oui | Texte recherché |
| `extends_search` | boolean | non | Étend la recherche au groupe du marchand (nouveau) |

Réponse : `status`, et `users`, dont chaque élément a `usr_id`, `first_name` (prénom),
`last_name` (nom), `email`, `photo` (URL) et `qr_code`. La v1.0 inversait nom et prénom.

### 8. Synchronisation des scans hors ligne

`POST {{base_url}}/marchandSynchScan.php` : le corps est une liste de scans.

| Requête (par scan) | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `qr_code` | string | oui | QR code du client |
| `mail` | string | oui | E-mail du client |
| `usr_id` | integer | non | Identifiant du client |
| `date` | string | non | Date et heure du scan |

Réponse : `status` = `ok`.

### 9. Utilisation d'une promotion

`POST {{base_url}}/marchandUserPromoV2.php` : le corps est une liste.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `qr_code` | string | oui | QR code du client |
| `message_id` | integer | oui | Identifiant de la promotion |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `is_user` | integer | `1` si le client existe |
| `used` | integer | `1` si la promotion a déjà été utilisée |
| `is_merchant` | integer | `1` si le marchand existe |

## Nouvelles routes (10 à 15)

Les 6 nouvelles routes couvrent deux usages : le client identifié par son seul téléphone
(routes 10 à 13) et les bons de réduction (routes 14 et 15). Attention, les routes 12, 14 et 15
répondent `status` = `success`, pas `ok`.

### 10. Identification ou inscription par téléphone

`POST {{base_url}}/registerCustomerByPhone.php` : retrouve le client par son téléphone. S'il
n'existe pas, il est créé avec un QR code et un solde de 0.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `phone` | string | oui | Téléphone du client |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `usr_id` | integer | Identifiant du client |
| `qr_code` | string | QR code du client |
| `phone` | string | Téléphone, client existant seulement |
| `total_points` | integer | Solde de points |
| `gifts` | array | Cadeaux accessibles avec ce solde : `id`, `nom`, `cout`, `photo` |
| `sms_optin` | boolean ou null | Consentement SMS chez ce marchand, `null` si jamais demandé |
| `profile_question` | object | Prochaine question de profil : `id`, `type`, `name`, `label`, `rank` |
| `code` | string | `ERR0400` (`merchant_id` ou `phone` manquant), `ERR0404` (marchand inconnu), `ERR0401` |

Ces trois erreurs ont aussi le statut HTTP correspondant (400, 404, 401), et non 200.

### 11. Consentement SMS

`POST {{base_url}}/customerGetOrUpdateSmsOptin.php` : sans `sms_optin`, lit le consentement.
Avec, l'enregistre, et crée le lien client-marchand s'il manque.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `user_id` | integer | oui | Identifiant du client |
| `sms_optin` | boolean | non | Nouveau consentement |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `ok` ou `error` |
| `usr_id`, `merchant_id` | integer | Client et marchand |
| `qr_code`, `phone` | string | QR code et téléphone du client |
| `sms_optin` | boolean ou null | Consentement après l'appel |
| `message` | string | `Read Success`, `Update Success`, `Create Success` ou `Create failed` |
| `profile_question` | object | Prochaine question de profil, comme à la route 10 |

### 12. Réponse à une question de profil

`POST {{base_url}}/customerSubmitResponse.php` : enregistre la réponse dans la fiche du client et
marque la question comme posée. Le consentement SMS (type `SMS_OPTIN`) passe par la route 11.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `user_id` | integer | oui | Identifiant du client |
| `question` | object | oui | La `profile_question` reçue : au moins `id` et `type` |
| `response` | string | oui | Réponse du client |

| `question.type` | Champ mis à jour | Format de `response` |
|---|---|---|
| `EMAIL` | E-mail | Adresse e-mail |
| `NAME` | Prénom | Texte |
| `GENDER` | Genre | `MALE` ou `FEMALE` |
| `BIRTH` | Date de naissance | Date |

Réponse : `{"status": "success", "message": "OK"}`. Erreurs : `ERR0400` (réponse vide ou genre
invalide), `ERR0404` (marchand inconnu), `User not found`.

### 13. Code PIN du client

`POST {{base_url}}/customerDeleteOrUpdatePinCode.php` : crée, change ou supprime le code PIN du
client. Le corps n'a pas de `merchant_id` : le marchand est celui de la signature.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `user_id` | integer | oui | Identifiant du client |
| `action` | string | oui | `update` (définit le PIN) ou `reset` (le supprime) |
| `pin` | string | si `update` | Nouveau code PIN |

Réponse : `status` = `ok`. Erreurs : `User not found`, `Pin code is missing` (PIN absent ou
`action` inconnue).

### 14. Vérification d'un bon de réduction

`POST {{base_url}}/checkCustomerVoucher.php` : vérifie qu'un bon est utilisable chez ce marchand,
et par ce client si son téléphone est fourni. N'utilise pas le bon : appeler ensuite la route 15.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `voucher` | string | oui | Code du bon |
| `phone` | string | non | Téléphone du client |

Un bon `OPEN` vaut pour tout client. Un bon `CLOSE` ne vaut que pour les clients qui lui sont liés.
Sans `phone`, si un bon `CLOSE` n'a qu'un client lié, la réponse renvoie ce client.

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `success` ou `error` |
| `data.voucher` | object | Le bon : `id`, `code`, `voucher_type` (`OPEN` ou `CLOSE`), `value`, `percentage`, `basket_minimum`, `activation_date`, `expiry_date`, `use_count`, `total_max_use`, `customer_max_use`, `products` |
| `data.user` | object | Fiche du client, si identifié |
| `code`, `message` | string | Code et message d'erreur |

`value` est un pourcentage si `percentage` est vrai, un montant sinon. `products` liste les
produits concernés par le bon.

| `code` d'erreur | Signification |
|---|---|
| `ERR0404` | `merchant_id` ou `voucher` manquant (HTTP 400) |
| `voucher-notfound` | Code inconnu chez ce marchand |
| `voucher-not-active` | Date d'activation pas encore atteinte |
| `voucher-expired` | Date d'expiration dépassée |
| `voucher-total-use-reached` | Nombre total d'utilisations atteint |
| `voucher-user-notfound` | Bon `CLOSE` et téléphone inconnu |
| `voucher-user-notlinked` | Bon `CLOSE` non attribué à ce client |
| `voucher-maxuse-reached` | Nombre d'utilisations par client atteint |
| `voucher-duplicate`, `user-duplicate`, `voucher-user-linkerror` | Doublon en base |
| `voucher-unknownerror` | Erreur serveur |

### 15. Utilisation d'un bon de réduction

`POST {{base_url}}/burnCustomerVoucher.php` : enregistre une utilisation du bon par le client,
avec le montant du panier. La route ne revérifie pas la validité du bon : la route 14 doit avoir
répondu `success` juste avant.

| Requête | Type | Requis | Description |
|---|---|---|---|
| `merchant_id` | integer | oui | Identifiant du marchand |
| `voucher` | string | oui | Code du bon |
| `user_id` | integer | oui | Identifiant du client |
| `basket_total` | decimal | oui | Montant du panier |

| Réponse | Type | Description |
|---|---|---|
| `status` | string | `success` ou `error` |
| `data` | object | Utilisation enregistrée : `id`, `voucher_id`, `marchand_id`, `mobileuser_id`, `created_at`, `use_count`, `basket_amount` |
| `code` | string | `voucher-notfound`, `user-notfound`, `voucher-duplicate`, `voucher-unknownerror` |

## Remarques d'intégration

Le code du serveur s'écarte de la v1.0 ou du comportement attendu sur 9 points, constatés le
25 novembre 2026. Ils sont à corriger côté serveur ou à contourner côté client.

| Route | Écart constaté | À faire côté client |
|---|---|---|
| Toutes | `sign_algo` est ignoré : le serveur vérifie toujours un HMAC-SHA256, alors que l'exemple v1.0 indique `HMAC_SHA1` | Signer en HMAC-SHA256 |
| 10, 11, 12, 14 | Certaines erreurs ont le statut HTTP 400, 401 ou 404 ; les autres routes répondent toujours HTTP 200 | Lire `status` dans le corps, quel que soit le statut HTTP |
| 3, 5, 14 | Le PIN du client est renvoyé en clair (`pin_code`, `pin_user`, et `data.user` qui contient toute la fiche du client) | Ne jamais afficher ni journaliser ces réponses |
| 13 | Le serveur ne vérifie pas que le client appartient au marchand : n'importe quel marchand signé peut changer le PIN de n'importe quel `user_id` | À corriger côté serveur |
| 15 | Le compteur global du bon est remis à 1 au lieu d'être incrémenté : la limite `total_max_use` ne fonctionne que si elle vaut 1 | À corriger côté serveur |
| 14 | Avec un téléphone inconnu et un bon `OPEN`, la création du client échoue (variables non définies) et `data.user` est inexploitable | Identifier d'abord le client avec la route 10 |
| 12 | `GENDER` = `FEMALE` est refusé (`ERR0400`) : seul `MALE` passe. Un `type` inconnu renvoie `success` sans rien enregistrer | À corriger côté serveur |
| 2 | Avec `is_desk` = 1, `categories` est toujours vide (faute de frappe `$$categories`) | Ne pas s'appuyer sur `categories` |
| 11 | Le lien avec le groupe du marchand (super-marchand) n'est jamais créé lors d'un premier consentement | À corriger côté serveur |

Les routes 4 et 9 ne sont appelées ni par la borne ni par la caisse. Leur description reprend la
v1.0 sans vérification dans le code.

---

## Analyse pour la commande en ligne (lot 21)

Le client de l'API est `packages/api-loyalty/src/youfid/client.ts` ; le fournisseur qui l'adapte
à `LoyaltyProvider` est `packages/api-loyalty/src/youfid/provider.ts`. Seul ce paquet appelle
l'API fidélité.

### Correspondance avec `LoyaltyProvider`

| `LoyaltyProvider` | YouFID | Remarques |
|---|---|---|
| `getProgram` | Route 2 | `products` → paliers (`id`, `cost`, `name`) ; nom = `loyalty_program.name`, sinon `name`. Points par euro et points de bienvenue absents de l'API : réglages de l'enseigne (défauts 10 et 100). `categories` ignoré (toujours vide). Cache 60 s, dernière version servie si YouFID ne répond pas |
| `join` | Route 10, puis route 12 (`NAME`, `EMAIL`), puis route 5 `forced_amount` (bienvenue) | Client créé ou retrouvé par téléphone. « Nouveau » = `phone` absent de la réponse. Prénom par défaut (« Membre ») jamais envoyé. Sans téléphone : un e-mail connu retrouve le client (route 3), sinon refus (pas de création par e-mail) |
| `findByPhone` | Lien local, puis route 3 par QR code | La route 10 crée le client : elle n'est appelée qu'à l'inscription, après acceptation des conditions |
| `findByEmail` | Route 3 (`email`) | Le lien local est créé ou mis à jour |
| `getMember` | Lien local (`usr_id` → `qr_code`), puis route 3 | L'identifiant de membre est le `usr_id` YouFID (texte) ; la carte VIP montre le `qr_code` |
| `updateProfile` | Route 11 (lecture, pour la question en attente) puis route 12 (`NAME`, `EMAIL`, `BIRTH`) | Un appel par champ. YouFID n'efface rien : l'effacement d'un champ reste local. E-mail et date de naissance copiés localement (la route 3 ne les renvoie pas). `GENDER` inutilisé |
| `settleOrder` | Route 6 (cadeau) puis route 5 avec `amount` | Exactement une fois grâce au registre local `loyalty_operations` (voir ADR 0026) |
| `adjustPoints` | Route 5 avec `forced_amount` | Positif seulement ; retrait refusé (« non pris en charge par YouFID ») |
| `history` | Registre local | Opérations faites par l'application seulement (`historyScope: "app"`) |
| `listMembers` | Liens locaux (sans recherche), route 7 (nom, prénom, e-mail), liens locaux (téléphone) | La route 7 ne cherche pas par téléphone et ne donne pas le solde : route 3 pour chaque résultat (20 au plus) |
| `deleteMember` | — | Pas de route : seul le lien local est effacé ; l'effacement chez YouFID se demande à Splash360 |

Routes 11, 14 et 15 : fonctions du client écrites et testées, non branchées sur l'application
(bons de réduction au paiement : étape suivante). Routes 4, 8 et 9 : non utilisées. Route 13 :
volontairement non implémentée (faille signalée, et pas de code PIN dans notre produit).

### Points d'attention

- **Pas de clé d'idempotence** sur la route 5 : un crédit dont la réponse est perdue ne peut pas
  être distingué d'un crédit non fait. Le registre local empêche tout nouvel envoi automatique ;
  l'opération passe « à vérifier » au back-office.
- **PIN client en clair** (routes 3, 5, 14) : les réponses sont lues par des schémas qui ne
  déclarent pas ces champs ; ils n'existent dans aucun objet renvoyé, ne sont ni stockés ni
  journalisés. La fiche `data.user` de la route 14 n'est pas lue.
- **`maximum_scans_reached`** : le gain n'est pas crédité ; traité comme un échec visible
  (registre « refusée », message au back-office), jamais ignoré.
- **Statuts** : `ok` / `ko` (route 3 : client absent) / `success` (routes 12, 14, 15) /
  `error`, lus dans le corps quel que soit le statut HTTP.
