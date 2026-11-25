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
| 17 | Ambassadeur (ADR 0019) : **format du QR des tickets Splash360** et moyen de vérifier qu'un ticket existe ; **compte Meta Business** de chaque enseigne et application Meta validée pour recevoir les mentions en story | Vérification automatique et crédit des 50 points | Lot 17 (ADR 0022) : « Mention reçue » cliquée au back-office, story réputée en ligne au contrôle de +20 h, points crédités à +24 h ; ticket « enregistré », non vérifié ; analyse de la photo dès que `ANTHROPIC_API_KEY` est posée |
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
