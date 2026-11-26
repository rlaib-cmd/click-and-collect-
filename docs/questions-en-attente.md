# Questions en attente de réponse

Tenu à jour pendant le développement autonome. Chaque point indique ce qu'il bloque et le choix provisoire retenu.

| # | Question | Bloque | Choix provisoire |
|---|---|---|---|
| 1 | ~~Documentation et accès de test de l'API menu Splash360~~ — **tranché : données de démonstration pour l'instant (ADR 0006)** (groupes d'options, photos, ruptures, allergènes, notifications de changement) | Fin du lot 2 | Cartes de démonstration derrière l'interface `MenuProvider` |
| 2 | Point d'entrée pour créer une commande dans la caisse et recevoir les statuts | Lot 5 | Interface `PosGateway` avec faux en mémoire |
| 3 | Durée maximale d'une carte servie quand l'API menu est en panne | Robustesse lot 2 | 60 min (`MENU_MAX_STALE_MINUTES`) |
| 4 | Une application par enseigne sur les stores, ou une seule ? | Lot 7 | Une par enseigne (ADR 0004) |
| 5 | Rémunération Splash360 : commission par commande, abonnement, ou les deux ? | Lot 4 (configuration Stripe) | Commission paramétrable par enseigne, 0 par défaut |
| 6 | Frais de service : montant fixe ou pourcentage ? | Lot 3 | Montant fixe par restaurant |
| 7 | Les commandes « dès que possible » comptent-elles dans le maximum par créneau ? | Lot 3 | Non : seules les commandes planifiées réservent un créneau |
| 8 | Hébergement de `apps/api` (région UE) et nom de domaine des sous-domaines | Lot 7 | — |
| 10 | Commission Splash360 remboursée au prorata en cas de remboursement ? | Lot 4 | Oui (`refund_application_fee`) : le restaurant ne paie pas de commission sur ce qu'il rembourse |
| 9 | Compte Expo/EAS, comptes Apple et Google, compte Stripe plateforme | Lots 4 et 7 | Mode test Stripe, sans build natif |
| 11 | Prestataire d'e-mail transactionnel (Brevo, Postmark, Resend…) et domaine d'envoi par enseigne | Lot 5 (reçu par e-mail) | E-mails journalisés, non envoyés |
| 12 | Validation du contrat caisse proposé (`docs/api-splash360/contrat-commande-en-ligne.md`) | Lot 5 | Caisse de démonstration |
| 13 | ~~Projet Supabase de recette~~ — **fait** (`docs/environnement-recette.md`) ; reste : production, Supabase Auth (premier super-administrateur) et activation de Supabase Auth pour le back-office | Lot 6 (connexion réelle) | Connexion de développement locale |
| 14 | Nom de domaine des enseignes (`<enseigne>.<domaine>`) et hébergeurs retenus | Lot 7 | Recommandations dans `mise-en-production.md` |
| 15 | Enseigne pilote, ses comptes Apple Developer / Google Play, icône et écran de démarrage | Lot 7 | Marques de démonstration `bella`, `greenbowl` |
| 16 | ~~Réponses de Splash360 sur l'API Click & Collect~~ — **répondu en grande partie (26/11, ADR 0024)** : statuts (rien après `confirmed`), annulation d'une commande `standby` en caisse seulement, frais à 20 % (format exact), heure de retrait dans `scheduledAt`, pas d'idempotence de `submitcommande`. Reste : **caisse de test**, **un identifiant par restaurant** | Branchement d'un restaurant réel (lot 14) | `scheduledAt` + commentaire, frais au format donné, dépôt jamais refait automatiquement, alerte « à annuler en caisse » |
| 17 | ~~Ambassadeur : format du QR des tickets Splash360 et moyen de vérifier qu'un ticket existe~~ — **répondu (25/11, ADR 0025)** : le `ticket_id` (UUID de l'export des ventes) est imprimé en texte sur le ticket de caisse et encodé dans le QR des tickets de borne ; journée comptable coupée à 02:00 (Paris) ; export paginé à partir de 0 (confirmé le 26/11). Reste : **compte Meta Business** de chaque enseigne et application Meta validée pour recevoir les mentions en story | Contrôle automatique de la story | Lot 20 : « Achat vérifié » — ticket photographié (identifiant lu par l'IA) ou QR de borne, vente cherchée par `ticket_id` dans l'export : vérifié, impayé (refus) ou introuvable (l'équipe tranche) ; jamais de crédit automatique avant. Mention : bouton « Mention reçue » au back-office (lot 17) |
| 18 | ~~Splash360 v2 : options, prix par mode~~ — **répondu (26/11, ADR 0024)** : identifiant d'ingrédient complet ; même option deux fois en `qte` ; étapes imbriquées à plat avec `ingid`/`parentid` ; `prixArray_c` = [sur place, à emporter, livraison, Uber, Deliveroo] ; export paginé à partir de 0. Reste : `regle.supplement_c`, `compo`/`composition`, `gifts`, catalogue à retenir quand il y en a plusieurs, et les points 19 à 21 | Options complètes | Appliqué (ADR 0024) ; premier produit rencontré quand il est dans deux catalogues |
| 19 | ~~**Ruptures de stock** : webhook Splash360~~ — **répondu (26/11, guide des webhooks, ADR 0029)** : quatre événements signés (Standard Webhooks), une URL par événement, station en dernier segment. Reste à Splash360 : **déclarer nos URL** et nous **transmettre les secrets** (`mise-en-production.md`) ; l'événement ne porte pas l'heure du changement en caisse (une tentative manquée peut ramener un ancien état) : à ajouter ? Un nouveau catalogue remet-il les ruptures à zéro ? | Ruptures en temps réel | Lot 23 : états appliqués à la carte et au prix ; au catalogue, prix de livraison propres effacés et disponibilités gardées |
| 20 | **Promotions de catalogue** (`reglescatalogue`, ex. « 3 achetés = 1 offert ») appliquées par la caisse à la réception : à appliquer en ligne, mais la forme ne suffit pas (détail dans `analyse-api-click-collect.md`) : article offert (le moins cher ?), répétition par lot, sens de `min`/`max`/`quantite`/`selection`/`taux`, options comprises ou non, livraison (aucune règle `livraison`), cumul avec code promo et cadeau, et façon de l'indiquer dans `submitcommande` | Prix en ligne = prix en caisse | Aucune promotion de catalogue appliquée en ligne ; écart éventuel remboursé au back-office |
| 21 | Hypothèses d'envoi à confirmer : `price` d'un ingrédient avec `qte` > 1 = prix unitaire ; option imbriquée envoyée avec `ingredient` **et** `ingid` ; remises (`discount`) gardées au format actuel ; un seul niveau d'imbrication des étapes | Formules complexes | Comme décrit (ADR 0024, réponses du 26/11) |
| 22 | **Identifiant de la station click and collect** (forme `123_4abc5def`) de **Chicken Street Siège** (Splash360 `1274`), et des autres restaurants à brancher | Webhooks reçus pour ce restaurant (lot 23) | Appels d'une station inconnue acceptés (2xx) et listés au back-office (« Webhooks reçus ») ; le super-administrateur règle la station du restaurant |

## API fidélité Splash360 (lot 8)

Le lot 8 tourne sur des données de test (ADR 0009). À obtenir de Splash360 :

1. Création de compte client et **vérification** (code SMS ou e-mail) : la connexion de test par simple e-mail ne peut pas aller en production.
2. Lecture du solde, de l'historique et du **contenu du QR code** présenté en caisse (format attendu par la caisse).
3. Règles du programme par enseigne : points par euro, points de bienvenue, récompenses (produit offert ? remise ?).
4. Crédit des points d'une commande en ligne, avec **idempotence** par commande.
5. Consommation d'une récompense : réservation à la commande, puis confirmation ou libération (paiement échoué, expiré).
6. Remboursement d'une commande : retrait des points gagnés et restitution de la récompense ?
7. Administration depuis le back-office (lot 9, ADR 0011) : **liste et recherche des membres** d'une enseigne
   (nom, e-mail, code carte, solde, date d'adhésion), **correction manuelle des points** avec motif
   (solde jamais négatif), **suppression d'un compte** (droit à l'effacement).

8. Connexion du client (lot 10, ADR 0012) : **recherche d'un membre par numéro de mobile** (E.164),
   **création d'un compte avec le seul téléphone** (e-mail facultatif). Splash360 envoie-t-il déjà un code
   de vérification par SMS, ou les clients ont-ils un code PIN ? Si oui, on s'appuie dessus plutôt que Brevo.

9. Paliers de cadeaux (lot 11, ADR 0014) : un palier propose **plusieurs produits au choix** ; l'API doit
   donner, pour chaque palier, ses produits (identifiants de la carte), et la consommation d'un cadeau doit
   indiquer le **produit choisi**.

## Paiement sur place (ADR 0010)

1. Format du QR code que la caisse Splash360 sait lire pour retrouver une commande en ligne (provisoire : `S360-CMD-<numéro>-<8 caractères>`).
2. La caisse peut-elle recevoir une commande « à encaisser » (non payée) et l'encaisser au retrait ?

## Fidélité dans le click & collect (lot 16, ADR 0021)

- Le prénom doit-il devenir facultatif dès la création du compte ? Aujourd'hui il est demandé avec
  l'acceptation des conditions (nom affiché sur la carte et transmis à la caisse) ; l'écran
  « Fais connaissance » le rend seulement modifiable. L'API fidélité Splash360 accepte-t-elle un
  membre sans nom ?
- La date de naissance doit-elle déclencher une offre anniversaire (points, cadeau) ? Rien n'est
  construit tant que la règle n'est pas donnée.

## Fidélité YouFID (lot 21, ADR 0026)

Questions pour Splash360 (Abdoul). Chacune indique le choix provisoire retenu.

| # | Question | Choix provisoire |
|---|---|---|
| Y1 | ~~URL de production de l'API~~ — **répondu (25/11)** : `https://api-loyalty.splash360.fr/dev/service/`, production comprise jusqu'à nouvel ordre | Défaut de `YOUFID_BASE_URL` |
| Y2 | ~~Points par euro et points de bienvenue~~ — **tranché par le propriétaire** : 1 point par euro (26/11, au lieu de 10), 100 de bienvenue, modifiables par enseigne. Depuis le 26/11, le gain d'une commande en ligne est calculé par notre règle et envoyé en crédit forcé (YouFID créditait 0 point avec le montant seul) | Réglages de l'enseigne = gain crédité en ligne ; en caisse, règle YouFID |
| Y3 | ~~Idempotence de la route 5~~ — **répondu (26/11)** : YouFID ne prend pas de numéro de commande. | Registre local `loyalty_operations` (une opération par commande, jamais de renvoi automatique d'une opération incertaine) : solution définitive |
| Y4 | ~~Limite de passages par jour~~ — **répondu (26/11)** : le bonus ambassadeur est un bonus, il ne bloque pas les points des commandes. | `maximum_scans_reached` reste affiché comme un échec s'il survient |
| Y5 | ~~Retirer des points~~ — **répondu (26/11)** : aucun retrait par les API POS, seulement par les API manager (hors périmètre). | Retrait refusé dans l'app (« non pris en charge par YouFID ») ; un retrait se fait dans l'outil manager YouFID |
| Y6 | **Historique du client** (passages, cadeaux, en magasin compris) : pas de route aujourd'hui (26/11) ; **route demandée à Splash360 sous 4 semaines (au plus tard le 24/12/2026)**, décision du propriétaire | Historique = opérations faites par l'application |
| Y7 | ~~Compte marchand de test~~ — **répondu (26/11)** : Chicken Street Siège est un environnement de test (caisse du bureau) ; commandes et points de test autorisés. Ne jamais toucher au restaurant **1292** (Tasty Crousty, client en production). | Recette sur Chicken Street Siège (1274) uniquement |
| Y8 | **Corrections serveur** (décision du propriétaire, 26/11) : route 13 (PIN de n'importe quel client, faille de sécurité) demandée **en urgence, sous quelques jours** ; routes 15 (compteur du bon) et 12 (`FEMALE`) non urgentes (non utilisées). Liste complète page 15 : route 13 (PIN de n'importe quel client), route 15 (compteur du bon remis à 1), route 14 (client inconnu + bon OPEN), route 12 (`FEMALE` refusé, type inconnu accepté sans rien enregistrer), route 2 (`categories` vide), route 11 (lien groupe) | Contournements : route 13 jamais appelée, catégories ignorées, genre non envoyé, bons non branchés |
| Y9 | Route 12 : l'`id` de la question est-il nécessaire, ou le `type` suffit-il ? On ne connaît que l'id de la prochaine question renvoyée | id de la question en attente si son type correspond, sinon 0 |
| Y10 | ~~Route 10 : format du téléphone~~ — **répondu (26/11)** : E.164 (`+33612345678`), le serveur compare les chaînes ; « Duplicated user » possible | E.164 seulement ; « Duplicated user » : message générique, journal du back-office |
| Y11 | Route 12, `BIRTH` : format de la date | `AAAA-MM-JJ` |
| Y12 | Route 10 : un nouveau client se reconnaît-il bien à l'absence de `phone` dans la réponse ? | Oui (bienvenue créditée seulement dans ce cas) |
| Y13 | ~~Route 5 : `amount`~~ — **répondu (26/11)** : envoyer `amount` (euros) avec `forced_amount` ; `forced_amount` fait foi, `amount` alimente les statistiques. Refus par `code` (`MAX_POINTS_REACHED`, `MAX_SCAN_REACHED`, `AMOUNT_TOO_HIGH`) | Gain d'une commande : les deux champs ; refus `balance_cap`, `daily_limit`, `amount_too_high` |
| Y14 | ~~Route 6 : erreur~~ — **répondu (26/11)** : message générique « Error: Problem during withdrawPoints on LOYALTY » | Solde contrôlé avant par la route 3 ; erreur → refus `redeem_failed` |
| Y15 | ~~Effacement RGPD chez YouFID~~ — **répondu (26/11)** : sur demande à YouFID, un mois au plus ; décision du propriétaire : l'enseigne l'envoie par e-mail | Lien local effacé, rappel au journal (`loyalty.erasure_requested`, ADR 0028) |
| Y16 | Inscription sans téléphone (e-mail seul) : la route 5 `is_register` demande un `qr_code` fourni par l'appelant ; qui le génère ? | Inscription par SMS uniquement |
| Y17 | Le `qr_code` renvoyé est-il exactement le contenu que la tablette scanne (carte VIP de l'app) ? **Répondu en partie (26/11)** : c'est un texte (8 chiffres commençant par 1 pour un compte créé par téléphone) | Affiché tel quel dans le QR, jamais converti en nombre |
| Y18 | ~~Validité des points~~ — **répondu (26/11)** : les points n'expirent pas | `validity` jamais affiché |
| Y19 | **Valeur du plafond de solde** (`MAX_POINTS_REACHED`) du marchand 2 | Refus `balance_cap` visible au back-office, sans contrôle préalable |
