# Chicken Street : fiches Google Play et App Store

État au 26/11 : les textes sont prêts et le build Android 1.1.0 (AAB, API de production) est construit
sur EAS. Il manque les comptes développeur, les visuels, les coordonnées de contact et l'accord de
l'enseigne sur sa marque. La configuration de l'application est dans `apps/mobile/brands/chickenstreet.json`.

| | Valeur |
| --- | --- |
| Nom affiché | Chicken Street |
| Paquet Android / identifiant iOS | `fr.splash360.commande.chickenstreet` |
| Profil EAS | `chickenstreet-production` (API de production) |
| Version | 1.1.1 |
| Catégorie | Cuisine et boissons (Google Play) ; Cuisine et boissons (App Store) |
| Contact, site, politique de confidentialité | **à fournir par l'enseigne** (e-mail de contact, site web, URL publique de la politique de confidentialité) |

## Textes

- **Nom** (30 car. max) : Chicken Street
- **Sous-titre App Store** (30 car. max) : Naan & Fried Chicken
- **Description courte Google Play** (80 car. max) :
  Commande ton poulet croustillant, à emporter ou livré, et cumule tes points.
- **Description complète** :

  Commande chez Chicken Street en quelques secondes, à emporter ou en livraison.

  - Toute la carte : naans, fried chicken, burgers et wraps, Ritchie Box, menus, desserts et boissons, avec tes options.
  - Commande dès que possible ou planifie ton heure de retrait.
  - Paiement au comptoir pour les membres du club (paiement en ligne bientôt disponible).
  - Suivi de ta commande en direct et QR code de retrait à présenter en arrivant.
  - Le club Chicken Street : 100 points offerts à l'inscription, 1 point par euro dépensé, en caisse comme
    dans l'app, et tes cadeaux à utiliser directement au panier.
  - Ta carte VIP dans l'app : présente ton QR code en caisse pour cumuler tes points.
  - Tague @chickenstreetfrance en story et gagne 50 points bonus par achat.
  - Bons plans à proximité (facultatif) : une notification quand tu passes près d'un restaurant.

- **Mots-clés App Store** (100 car. max) :
  poulet,fried chicken,naan,burger,wrap,click and collect,livraison,fidélité,commande,restaurant

## Sécurité des données (Google Play) et confidentialité (App Store)

| Donnée | Collectée | Usage | Partagée |
| --- | --- | --- | --- |
| Numéro de téléphone | Oui (connexion au club) | Compte, fidélité (Splash360 / YouFID), SMS de connexion (Brevo) | Prestataires techniques uniquement |
| Prénom, e-mail, date de naissance | Facultatif | Profil du club | Splash360 / YouFID |
| Commandes et paiements | Oui | Exécution de la commande | Restaurant (caisse Splash360), Stripe pour le paiement en ligne |
| Photo (ticket, story) | Facultatif | Vérification de l'achat et de la photo, **jamais conservée** | Analyse par Anthropic (Claude), sans stockage |
| Position | Facultatif, désactivée par défaut | « Bons plans à proximité » : seule l'entrée dans une zone de 200 m est transmise, **aucun historique de position** | Non |
| Jeton de notification | Facultatif | Suivi de commande, bons plans | Expo (envoi des notifications) |

Pas de publicité, pas de suivi entre applications, pas de revente de données.

**Suppression du compte** (App Store 5.1.1(v), Google Play « Suppression des données ») : dans
l'application, **Compte → Supprimer mon compte**, puis confirmation. Le compte club, les points,
le profil, les cartes bancaires enregistrées, les données « à proximité » et Ambassadeur en attente
sont effacés, et toutes les sessions sont fermées. La fiche chez le partenaire de fidélité (YouFID)
est effacée sur demande envoyée par e-mail à YouFID par l'enseigne, sous un mois au plus (ADR 0028). Aussi possible sur demande
à l'enseigne (effacement depuis le back-office).

## Autorisations et justification pour la revue

- **Caméra** : scanner le QR code d'un ticket de borne et photographier son ticket ou son produit
  (programme ambassadeur). Utilisée seulement à la demande du client.
- **Localisation « Toujours » (iOS) / en arrière-plan (Android)** : uniquement si le client active
  « Bons plans à proximité » dans son compte. Le téléphone surveille une zone de 200 m autour des
  restaurants ; à l'entrée, l'app prévient le serveur, qui peut envoyer un bon plan. Aucun historique
  de position. Désactivable à tout moment. Texte à copier dans les notes de revue :
  « Location is used only when the user opts in to “Bons plans à proximité” (Account screen). The app
  registers 200 m geofences around the brand's restaurants and only reports region entries to send an
  offer; no location history is stored. »
- **Mode d'arrière-plan `fetch`** (iOS) : ajouté automatiquement par `expo-task-manager`, non utilisé.
- **Notifications** : suivi de commande et bons plans, après accord du client.

## Compte de test pour la revue Apple et Google

La connexion se fait par code SMS : les relecteurs ne peuvent pas le recevoir. Avant l'envoi en revue,
prévoir l'une de ces solutions :

1. Connexion par **code e-mail** vers une adresse de relecture : nécessite `EMAIL_SENDER` et
   `EMAIL_SENDER_NAME` (expéditeur vérifié dans Brevo) dans les secrets de production.
2. Un numéro de test dédié, dont le code est transmis dans les notes de revue.

## Visuels à fournir

| Visuel | Format |
| --- | --- |
| Icône | 1024 × 1024 px, sans transparence (App Store) ; 512 × 512 px (Google Play) |
| Bannière Google Play | 1024 × 500 px |
| Captures téléphone | au moins 2 (Google Play), 6,7" et 6,5" (App Store) : accueil, carte, produit, panier, carte VIP, club |

## Étapes restantes

1. Comptes : Google Play Console (25 $ une fois) et Apple Developer (99 € par an), au nom de la société.
2. iOS : connecter le compte Apple à EAS une fois depuis un ordinateur
   (`cd apps/mobile && BRAND=chickenstreet npx eas-cli build -p ios --profile chickenstreet-production`).
3. Android : premier envoi à la main de l'AAB 1.1.0 dans « Tests internes », puis envois automatiques
   (clé de compte de service, voir `google-play.md`).
4. Fiches (textes ci-dessus), sécurité des données, classification du contenu, compte de test, puis revue.
