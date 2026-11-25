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
| 16 | Réponses de Splash360 sur l'API Click & Collect (liste dans `docs/api-splash360/analyse-api-click-collect.md`). Prioritaires pour brancher : **caisse de test** (une commande d'essai arrive-t-elle dans une vraie caisse ?), **un identifiant par restaurant** (la carte n'a pas de paramètre de restaurant), **valeurs exactes des statuts** de `cmdstatus`, **annulation** d'une commande `standby` jamais payée, **taux de TVA des frais**, **champ pour l'heure de retrait**, format des options (`composition`, `steps`) | Branchement d'un restaurant réel (lot 14) | Code prêt (ADR 0018) : statuts lus de façon tolérante, heure de retrait en commentaire, frais à 20 %, produits sans options ; aucun restaurant branché |
| 17 | ~~Ambassadeur : format du QR des tickets Splash360 et moyen de vérifier qu'un ticket existe~~ — **répondu (25/11, ADR 0025)** : le `ticket_id` (UUID de l'export des ventes) est imprimé en texte sur le ticket de caisse et encodé dans le QR des tickets de borne ; journée comptable coupée à 02:00 (Paris) ; export paginé à partir de 1. Reste : **compte Meta Business** de chaque enseigne et application Meta validée pour recevoir les mentions en story | Contrôle automatique de la story | Lot 20 : « Achat vérifié » — ticket photographié (identifiant lu par l'IA) ou QR de borne, vente cherchée par `ticket_id` dans l'export : vérifié, impayé (refus) ou introuvable (l'équipe tranche) ; jamais de crédit automatique avant. Mention : bouton « Mention reçue » au back-office (lot 17) |
| 18 | Splash360 v2 (lot 19, ADR 0024), à poser à Abdoul : **identifiant d'ingrédient attendu par `submitcommande`** (`ing15407-typ2075` complet ou `ing15407`) ; `produit_id` est « prd… » et non « pro… » ; **`max_par_produit` = 2** (même option deux fois : comment l'envoyer ?) ; **étapes imbriquées** (`steps[].produit` = « ing…-typ8635 » : étape d'un ingrédient choisi dans une formule) ; sens des 5 entrées de `prixArray_c` (carte d'exemple : 9,00 / 9,00 / 10,80 / 11,60 / 11,60 €) ; `regle.supplement_c` (toujours 0) ; `compo`/`composition` ; types sans règle ; `reglescatalogue` (« 3 achetés = 1 offert ») et `gifts` ; catalogue à retenir quand il y en a plusieurs (carte d'exemple : « TASTY CROUSTY » et « DELIVERY ») ; ruptures de stock ; **format de réponse de l'export des ventes** (`/api/export/orders`) et lien ticket ↔ QR pour l'ambassadeur | Options complètes, vérification des tickets ambassadeur | Un choix par option ; étapes imbriquées, promotions et prix par mode ignorés ; `prix_c` ; `ingredient_id` complet ; libellé `legende` ; premier produit rencontré quand il est dans deux catalogues ; vérification des tickets par les ventes non codée |

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
| Y2 | ~~Points par euro et points de bienvenue~~ — **tranché par le propriétaire (25/11)** : 10 points par euro, 100 de bienvenue, modifiables par enseigne. Reste à confirmer : le taux configuré chez YouFID pour chaque marchand (YouFID calcule lui-même le gain sur `amount`) doit être le même que celui affiché par l'app | Réglages de l'enseigne, gain réel = celui de YouFID |
| Y3 | **Idempotence de la route 5** — **réponse partielle (26/11)** : Splash360 accepte qu'on envoie le numéro de commande ; **champ à préciser** (non documenté). | Registre local en attendant ; aucun renvoi automatique d'une opération incertaine |
| Y4 | ~~Limite de passages par jour~~ — **répondu (26/11)** : le bonus ambassadeur est un bonus, il ne bloque pas les points des commandes. | `maximum_scans_reached` reste affiché comme un échec s'il survient |
| Y5 | **Retirer des points** — **réponse partielle (26/11)** : c'est possible, **où ?** (réponse coupée). La documentation ne décrit aucune route de retrait. | Retrait refusé (« non pris en charge par YouFID ») ; aucun retrait par montant négatif |
| Y6 | **Historique du client** (passages, cadeaux, en magasin compris) : une route existe-t-elle ? | Historique = opérations faites par l'application |
| Y7 | ~~Compte marchand de test~~ — **répondu (26/11)** : Chicken Street Siège est un environnement de test (caisse du bureau) ; commandes et points de test autorisés. Ne jamais toucher au restaurant **1292** (Tasty Crousty, client en production). | Recette sur Chicken Street Siège (1274) uniquement |
| Y8 | Corrections serveur listées page 15 : route 13 (PIN de n'importe quel client), route 15 (compteur du bon remis à 1), route 14 (client inconnu + bon OPEN), route 12 (`FEMALE` refusé, type inconnu accepté sans rien enregistrer), route 2 (`categories` vide), route 11 (lien groupe) | Contournements : route 13 jamais appelée, catégories ignorées, genre non envoyé, bons non branchés |
| Y9 | Route 12 : l'`id` de la question est-il nécessaire, ou le `type` suffit-il ? On ne connaît que l'id de la prochaine question renvoyée | id de la question en attente si son type correspond, sinon 0 |
| Y10 | Route 10 : format du téléphone attendu (`0612345678` comme sur la tablette, ou `+33612345678`) ? Un mauvais format créerait un doublon d'un client connu en magasin | Format national `06…` pour la France |
| Y11 | Route 12, `BIRTH` : format de la date | `AAAA-MM-JJ` |
| Y12 | Route 10 : un nouveau client se reconnaît-il bien à l'absence de `phone` dans la réponse ? | Oui (bienvenue créditée seulement dans ce cas) |
| Y13 | Route 5 : `amount` = total payé, frais de livraison compris et cadeau déduit ? En euros décimaux (`12.5`) ? | Total payé en euros, frais compris, pas d'appel si le total est nul |
| Y14 | Route 6 : contrôle-t-elle le solde ? Quel message en cas de solde insuffisant ? `id` du cadeau en nombre ? | Solde contrôlé avant par la route 3 ; id envoyé en nombre |
| Y15 | Effacement RGPD d'un client chez YouFID : quelle procédure ? | Lien local effacé, effacement YouFID à demander |
| Y16 | Inscription sans téléphone (e-mail seul) : la route 5 `is_register` demande un `qr_code` fourni par l'appelant ; qui le génère ? | Inscription par SMS uniquement |
| Y17 | Le `qr_code` renvoyé est-il exactement le contenu que la tablette scanne (carte VIP de l'app) ? | Oui, affiché tel quel dans le QR |
| Y18 | Les points ont une durée de validité (`loyalty_program.validity`) : faut-il l'afficher ? | Non affichée |
