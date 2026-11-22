# Google Play — publication d'une enseigne (exemple : Bills Burger)

Statut : prêt côté code. Manquent : le compte développeur Google Play (25 €), la clé de service pour
l'envoi automatique, les visuels de la fiche et l'accord de l'enseigne sur sa marque.

## Étapes

1. **Compte** : créer le compte développeur Google Play (play.google.com/console), au nom de la société.
2. **Application** : « Créer une application », nom « Bills Burger », langue français, application gratuite.
   Identifiant du paquet : `fr.splash360.commande.billsburger` (fixé dans `apps/mobile/brands/billsburger.json`).
3. **Premier envoi à la main** (exigé par Google pour une nouvelle application) :
   `eas build --profile billsburger-production --platform android` puis téléverser le fichier `.aab`
   dans « Tests internes ».
4. **Envois suivants automatiques** : créer un compte de service Google Cloud avec accès à la Play Console,
   télécharger sa clé JSON dans `apps/mobile/google-play-service-account.json` (jamais commitée), puis
   `eas submit --profile billsburger-production --platform android` (piste « internal », brouillon).
5. **Fiche** (textes ci-dessous), **sécurité des données**, **classification du contenu**, **public cible**,
   puis passage en test fermé et en production.

## Textes de la fiche

- **Nom** (30 car. max) : Bills Burger
- **Description courte** (80 car. max) : Commande tes smash burgers à emporter ou en livraison, et cumule tes points.
- **Description complète** :

  Commande chez Bills Burger en quelques secondes, à emporter ou en livraison.

  - Toute la carte : smash burgers, bons plans, sides, desserts et boissons, avec tes options.
  - Commande dès que possible ou planifie ton heure de retrait.
  - Paiement en ligne sécurisé, ou paiement au comptoir pour les membres du club.
  - Suivi de ta commande en direct et QR code de retrait à présenter en arrivant.
  - Le club Bills Burger : tes points à chaque commande, tes récompenses et ta carte de fidélité dans l'app.
  - « Commander comme la dernière fois » en un geste.

- **Catégorie** : Cuisine et boissons. **Coordonnées** : e-mail de contact de l'enseigne, site bills-burger.fr.

## Visuels à fournir (par l'enseigne)

| Visuel | Format |
| --- | --- |
| Icône | 512 × 512 px, PNG 32 bits |
| Image de présentation | 1024 × 500 px, JPG ou PNG |
| Captures d'écran téléphone | 2 à 8, 1080 × 1920 px minimum (accueil, carte, produit, panier, ma carte, suivi) |
| Icône et écran de démarrage de l'application | 1024 × 1024 px, fond transparent ou couleur de la marque |

## Sécurité des données (réponses à la Play Console)

Données réellement traitées par l'application et le serveur (voir `supabase/migrations/`) :

| Donnée | Collectée | Usage | Partagée |
| --- | --- | --- | --- |
| Nom, e-mail, téléphone | Oui | Commande, reçu, club fidélité | Non (le restaurant de l'enseigne la reçoit pour la commande) |
| Adresse de livraison | Oui, en livraison | Livraison | Non |
| Historique d'achats, points | Oui | Suivi, fidélité | Non |
| Paiement | Traité par Stripe, jamais stocké par l'application | Paiement | Stripe (prestataire de paiement) |
| Identifiant de notification | Oui, si accepté | Notifications de suivi | Expo (prestataire d'envoi) |
| Localisation précise | Non | — | — |
| Publicité, suivi entre applications | Non | — | — |

Données chiffrées en transit (HTTPS). Suppression : sur demande au restaurant (anonymisation depuis le back-office).

## Politique de confidentialité

Google exige une URL. Elle peut être la page `/legal` de l'application web de l'enseigne, dont le texte
se règle dans le back-office (Design → Conditions générales et mentions légales). Le texte doit être
rédigé ou validé par l'enseigne (responsable du traitement) : identité, finalités, durées de conservation,
droits des personnes, contact. Le tableau ci-dessus liste les données réellement traitées.
