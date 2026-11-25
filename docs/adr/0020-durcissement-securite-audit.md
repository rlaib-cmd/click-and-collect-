# ADR 0020 — Durcissement de sécurité après l'audit du 25/11

Statut : acceptée (25/11/2026).

## Contexte

Un audit de sécurité indépendant (lecture du code) a relevé une faille haute (H1), six moyennes
(M1 à M6) et plusieurs points bas. Aucune faille critique, aucune injection SQL.

## Décisions

- **Comptes du back-office (H1, M1)** : un compte Supabase Auth peut appartenir à plusieurs
  enseignes. L'unicité de `staff_users.auth_user_id` devient « une fois par enseigne ». Le
  rattachement d'une invitation se fait ligne par ligne et ne bloque jamais la connexion. Une
  adresse de super-administrateur ne peut pas être invitée dans une enseigne (déclencheur en base).
  Le rattachement n'a lieu que si l'adresse du jeton est confirmée (`is_anonymous` et
  `user_metadata.email_verified`), en plus des réglages Supabase Auth : confirmation d'e-mail
  obligatoire et inscriptions publiques fermées.
- **Adresse client (M2)** : la limitation de débit lit l'en-tête posé par l'hébergeur
  (`cf-connecting-ip` sur Supabase Edge, `fly-client-ip` sur Fly), sinon la dernière entrée
  d'`X-Forwarded-For`, jamais la première. Plafond global d'envoi de codes par enseigne et par
  heure (`OTP_TENANT_HOURLY_LIMIT`, défaut 300), compté en base.
- **Caisse réelle (M3)** : brancher ou débrancher Splash360 est réservé au super-administrateur.
- **Jeton de membre (M4)** : format `m2.<membre>.<expiration>.<version>.<signature>`, valable
  90 jours ; table `loyalty_member_sessions` : chaque connexion par code incrémente la version et
  révoque les jetons précédents. Les anciens jetons (format v1) sont refusés : reconnexion.
  En production, l'adhésion passe par code (`LOYALTY_OTP=1`, connexion de démonstration coupée).
- **Envois en caisse (M5)** : jamais de relance ni d'envoi pour une commande annulée ou
  remboursée ; alertes et relances limitées au restaurant de l'équipier.
- **Back-office obsolète (M6)** : plafond par adresse appliqué avant le garde de version ; au plus
  20 requêtes retenues par instance, 60 s chacune.
- **Points bas** : récompense recontrôlée sous verrou du membre à la création de commande ; un avis
  Stripe tardif ne rend « payée » qu'une commande annulée par expiration ; une clé d'idempotence
  n'est rejouée que pour le même restaurant et le même client ; `APP_ENV` vaut `production` par
  défaut et la connexion de démonstration est désactivée par défaut ; `X-Tenant-Id` mal formé →
  400 ; erreur Splash360 brute non renvoyée au navigateur ; export CSV : tabulation et retour
  chariot neutralisés.

## Conséquences

Les membres connectés avec un ancien jeton doivent se reconnecter une fois. La recette garde son
comportement en posant explicitement `APP_ENV=recette` et `LOYALTY_DEMO_LOGIN=1`.
