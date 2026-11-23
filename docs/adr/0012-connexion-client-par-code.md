# ADR 0012 — Connexion du client par code (SMS ou e-mail)

**Statut** : Acceptée — 23/11/2026 (lot 10)

## Contexte

Le client doit pouvoir se connecter à son compte club depuis l'application et y retrouver les points
gagnés en caisse. Dans Splash360, un client inscrit en caisse est reconnu **surtout par son téléphone**.
La connexion de test par simple e-mail (ADR 0009) ne vérifie rien : elle ne peut pas aller en production.
Choix de l'utilisateur : SMS envoyés par **Brevo** (déjà retenu pour les e-mails), plan B gratuit par
e-mail, « Continuer avec Google » plus tard.

## Décision

- **Un seul parcours pour se connecter ou s'inscrire** : numéro de mobile → code à 6 chiffres reçu par
  SMS → si aucun compte n'existe pour ce numéro, prénom et CGU, puis création avec les points de
  bienvenue. Même parcours avec un code reçu par e-mail.
- **Règles dans `packages/core`** (`otp.ts`, testées) : code valable 10 minutes, 5 essais au plus
  (la fin d'inscription compte comme un essai), 60 s entre deux envois, 5 envois par heure et par
  identifiant ; numéro français normalisé au format E.164 (`+33…`), seuls les mobiles (06, 07) reçoivent
  un SMS ; nom d'expéditeur SMS = nom de l'enseigne, 11 caractères alphanumériques.
- **Côté serveur** (`apps/api/src/loyalty/otp.ts`) : table `customer_otp_challenges` (RLS sans règle :
  serveur seul). Le code n'est jamais stocké : empreinte HMAC-SHA256 avec un secret dérivé du secret
  des jetons. Comparaison à temps constant, essais comptés atomiquement, code à usage unique.
  Réponse identique qu'un compte existe ou non (pas d'énumération des clients). Limite par IP en plus.
- **Session** : le même jeton de membre signé qu'au lot 8 ; rien ne change pour la commande.
- **Téléphone = identifiant principal** des membres de démonstration (`unique (tenant_id, phone)`),
  e-mail facultatif. `LoyaltyProvider.findByPhone` ; l'API Splash360 devra fournir l'équivalent.
- **Envoi** : SMS transactionnel Brevo (`POST /v3/transactionalSMS/send`), e-mail par l'envoi existant.
  Sans clé Brevo, le message est journalisé (numéro masqué) et non envoyé.
- **Recette** : `OTP_DEBUG_ECHO=1` renvoie le code dans la réponse pour tester sans SMS, **seulement**
  si aucun prestataire n'est configuré pour ce canal **et** `APP_ENV` n'est pas `production` (testé).
  La connexion de test par e-mail reste en recette (tests mabl), jamais en production.
- **Google** : emplacement prêt dans l'écran, masqué (`EXPO_PUBLIC_GOOGLE_LOGIN=1` pour l'afficher)
  tant que le projet Google Cloud n'existe pas.

## Conséquences

- Coût : un SMS par connexion (~0,05 € en France chez Brevo), plafonné par les limites d'envoi.
- Production : `LOYALTY_OTP=1`, `APP_ENV=production`, `BREVO_API_KEY` avec SMS activés et crédits.
- Quand l'API fidélité Splash360 arrivera : recherche d'un membre par téléphone et création avec
  téléphone ; si Splash360 sait déjà envoyer un code (ou a un code PIN client), on pourra s'appuyer dessus.
