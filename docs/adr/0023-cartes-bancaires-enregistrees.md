# ADR 0023 — Cartes bancaires enregistrées : client Stripe de la plateforme, carte clonée au paiement

Date : 2026-11-25 · Statut : acceptée

## Contexte

Demande de l'utilisateur (« La carte bancaire ») : un membre du club enregistre sa carte dans
Compte → « Mes moyens de paiement », puis paie ses commandes plus vite (« Payer avec Visa •••• 4242 »).

Contraintes existantes :

- **Paiements directs** (ADR 0006) : chaque restaurant a son compte Stripe connecté, le
  PaymentIntent de la commande est créé sur ce compte, avec la commission Splash360
  (`application_fee_amount`). Une enseigne peut avoir plusieurs restaurants, donc plusieurs comptes.
- Aucune donnée de carte et aucune clé secrète dans l'application ; prix calculé par le serveur ;
  commande « payée » seulement par webhook Stripe vérifié.

Une carte enregistrée sur le compte d'un restaurant ne serait utilisable que dans ce restaurant.
Stripe documente pour ce cas le partage de moyens de paiement entre comptes pour les paiements
directs : client (`Customer`) et carte sur la **plateforme**, puis copie (« clone ») de la carte vers
le compte connecté au moment de payer (`POST /v1/payment_methods` avec `customer` et
`payment_method`, en-tête `Stripe-Account`).

## Décision

1. **Un client Stripe par membre du club et par enseigne**, sur la plateforme. Table
   `stripe_customers (tenant_id, member_id, stripe_customer_id)` : `tenant_id`, RLS activée sans
   règle (seule l'API, rôle de service, y accède), test pgTAP. Création à la première carte, avec une
   clé d'idempotence `cus-<enseigne>-<membre>` ; en cas de course, la première ligne enregistrée gagne.
2. **Ajout d'une carte** : `POST /v1/tenants/:s/loyalty/me/cards/setup` (jeton de membre) crée un
   SetupIntent sur la plateforme (`usage: off_session`, cartes seulement) ; l'application le confirme
   avec le Payment Element (web) ou la feuille de paiement (iOS/Android), clé publiable de la
   plateforme, sans compte de restaurant. Le numéro de carte ne passe jamais par nos serveurs.
3. **Liste, suppression, carte par défaut** : `GET …/loyalty/me/cards` (marque, 4 derniers chiffres,
   expiration, par défaut), `DELETE …/loyalty/me/cards/:pm` (détachement chez Stripe),
   `POST …/loyalty/me/cards/:pm/default` (`invoice_settings.default_payment_method` du client).
   Avant toute action, le serveur relit la carte chez Stripe et vérifie qu'elle appartient au client
   **de ce membre dans cette enseigne** ; sinon « carte inconnue » (404, même réponse qu'une carte
   inexistante).
4. **Paiement** : `POST /v1/tenants/:s/orders/:id/payment/saved-card` avec le jeton de suivi de la
   commande (`Authorization`) et le jeton du membre (`X-Member-Token`), corps
   `{ paymentMethodId, returnUrl? }`. Mêmes contrôles que le paiement classique (commande payable,
   restaurant encaissable, **caisse prête**, ADR 0018), puis le **même PaymentIntent** (clé
   d'idempotence `pi-<commande>` : montant du serveur, commission) ; la carte est clonée vers le
   compte du restaurant et le PaymentIntent confirmé par le serveur. Réponse : `succeeded`,
   `processing`, `requires_action` (l'application termine le 3-D Secure avec `handleNextAction`,
   compte du restaurant) ou `failed` (carte refusée : le client choisit un autre moyen). Un
   PaymentIntent déjà lancé n'est jamais reconfirmé (double clic). La commande passe à « payée »
   uniquement par le webhook, comme pour les autres moyens.
5. **Autres moyens toujours proposés** : sous les boutons « Payer avec … », le Payment Element ou la
   feuille de paiement restent affichés (Apple Pay, Google Pay, autre carte).
6. **Limitation de débit** : création de SetupIntent et paiement avec carte enregistrée sont dans le
   plafond strict des routes de commande (20 par minute et par adresse par défaut).
7. **Sans Stripe configuré** : liste vide, ajout « indisponible » (503) ; rien ne change pour le
   paiement classique.

## Conséquences

- **Pas d'enregistrement pendant un paiement** (case « Enregistrer ma carte » au paiement) en v1 :
  `setup_future_usage` sur un paiement direct enregistrerait la carte sur le compte du restaurant,
  pas sur la plateforme, donc pas réutilisable dans les autres restaurants. La carte s'ajoute depuis
  « Mes moyens de paiement ». À revoir si Stripe permet de l'enregistrer sur la plateforme au même
  moment.
- Les copies de carte sur les comptes des restaurants restent attachées à un client de ce compte
  ou non : la suppression côté plateforme empêche toute nouvelle copie ; une copie ne sert qu'au
  paiement en cours.
- Mobile : le 3-D Secure passe par le SDK natif (`handleNextAction`) : build de développement EAS
  nécessaire, comme pour la feuille de paiement.
- Adresse de retour 3-D Secure de l'app web : la page en cours (https) ; variable optionnelle
  `CLIENT_APP_URL` côté serveur en secours.
- Production : migration `20261125080000_stripe_customers.sql`, puis la fonction `api`.
