# Cahier des charges — Commande en ligne Splash360 (Expo, Stripe, back-office)

2026-11-22 · Ramzi

## 1. Objectif et périmètre

Splash360 Commande est une application de commande en ligne en marque blanche : chaque enseigne cliente de Splash360 obtient son application iOS, Android et web, à ses couleurs, où ses clients commandent en Click & Collect ou en livraison et paient avant que la commande parte en cuisine.

Le parcours client est celui du prototype validé : accueil (mode, adresse, jour et heure), carte, fiche produit avec options, panier, récapitulatif, paiement, suivi.

**Dans le périmètre de la V1**

- Application client unique (un seul code) pour iOS, Android et web.
- Click & Collect et livraison, activables séparément ou ensemble par restaurant.
- Commande immédiate ou planifiée : choix du jour, puis de l'heure.
- Paiement en ligne obligatoire par carte, Apple Pay et Google Pay, via Stripe.
- Carte lue en direct dans l'API menu Splash360 : produits, prix, options, photos, disponibilité.
- Back-office : création des comptes clients, design et logo, réglages de commande, suivi des commandes, remboursements.
- Envoi des commandes payées vers la caisse et la cuisine Splash360.

**Hors périmètre de la V1**

- Saisie ou modification de la carte dans le back-office : la carte se gère dans Splash360, source unique.
- Pourboire, fidélité, codes promo (prévoir les emplacements, ne pas les développer).
- Attribution et suivi GPS des livreurs : le restaurant livre lui-même et change le statut à la main.
- Titres-restaurant : dépend du prestataire de paiement, voir section 11.

## 2. Décisions techniques

Ces choix sont à donner tels quels à Claude Code ; ceux marqués « à confirmer » sont repris en section 11.

| Sujet | Choix | Pourquoi |
|---|---|---|
| Application client | Expo (dernière version stable), React Native, TypeScript, Expo Router | Un seul code pour iOS, Android et web ; builds et mises à jour par EAS |
| Back-office | Next.js (App Router), TypeScript | Application web d'administration classique, simple à héberger |
| Carte | API menu Splash360, en lecture seule, avec cache | Une API commune à la caisse, la borne et la commande en ligne |
| Données propres à la commande | Postgres avec Supabase (base, authentification, stockage des logos, temps réel, fonctions serveur) — à confirmer | Rapide à mettre en place ; à remplacer par le back-end Splash360 s'il peut porter ces données |
| Paiement | Stripe Connect, paiements directs sur le compte du restaurant | Chaque restaurant encaisse sur son propre compte ; commission Splash360 possible par transaction |
| Paiement sur mobile | Feuille de paiement Stripe (`@stripe/stripe-react-native`) | Carte, Apple Pay et Google Pay dans un seul composant |
| Paiement sur le web | Stripe Payment Element | Même logique serveur que le mobile |
| Multi-enseigne | Un seul code ; la configuration de l'enseigne (thème, logo, réglages) est chargée au démarrage | Ajouter un client ne demande aucun développement |
| Dépôt | Monorepo pnpm + Turborepo | Types, thème et client d'API partagés entre les applications |
| Langue | Français, textes externalisés (i18n) | Autres langues possibles plus tard |

Deux contraintes à connaître dès le départ :

- Apple Pay et Google Pay ne fonctionnent pas dans Expo Go : il faut un build de développement, via EAS Build ([documentation Expo sur Stripe](https://docs.expo.dev/versions/latest/sdk/stripe)).
- La version de `@stripe/stripe-react-native` dépend de la version d'Expo : toujours l'installer avec `npx expo install @stripe/stripe-react-native`.

## 3. Architecture et modèle de données

Trois applications partagent un même dépôt et parlent à deux sources : l'API menu Splash360 pour la carte, et la base de la commande en ligne pour tout le reste.

```text
splash-commande/
  apps/
    client/        Expo : iOS, Android, web (application de commande)
    backoffice/    Next.js : administration Splash360 et enseignes
  packages/
    api-menu/      client typé de l'API menu Splash360 (lecture seule)
    core/          règles métier : prix, frais, minimum, créneaux, validation des options
    ui/            thème et composants partagés
    types/         types TypeScript communs
  supabase/
    migrations/    schéma SQL et règles d'accès par enseigne
    functions/     création de commande, paiement Stripe, webhooks, envoi à la caisse
```

**Règle de base :** le calcul des prix se fait toujours côté serveur, à partir de l'API menu, avec le code de `packages/core`. L'application n'envoie que des identifiants de produits et d'options, jamais de montants.

**Tables de la base (hors carte)**

| Table | Contenu |
|---|---|
| `tenants` | Une ligne par enseigne cliente : nom, sous-domaine, identifiant dans Splash360, statut |
| `tenant_theme` | Logo, couleur principale, thème clair ou sombre, slogan |
| `restaurants` | Points de vente d'une enseigne : adresse, identifiant Splash360, compte Stripe connecté |
| `restaurant_settings` | Modes actifs, délai de préparation, frais de livraison, minimum, seuil de livraison offerte, frais de service, jours d'avance, pas des créneaux, commandes maximum par créneau |
| `opening_hours` | Plages de commande par jour de la semaine, fermetures exceptionnelles |
| `delivery_zones` | Rayon ou codes postaux desservis, frais par zone |
| `staff_users` | Comptes du back-office et rôle : super-administrateur Splash360, administrateur d'enseigne, équipier |
| `customers` | Clients finaux : nom, téléphone, e-mail, adresses enregistrées |
| `orders` | Commande : restaurant, client, mode, adresse, heure demandée, montants, statut, identifiant du paiement Stripe |
| `order_items` | Lignes : identifiant produit Splash360, libellé et prix figés au moment de la commande, quantité, note |
| `order_item_options` | Options choisies par ligne, libellé et prix figés |
| `order_events` | Historique des changements de statut, avec date et auteur |

Chaque table porte l'identifiant de l'enseigne, et les règles d'accès de la base interdisent à une enseigne de lire les données d'une autre.

**Statuts d'une commande :** `en_attente_paiement` → `payée` → `acceptée` → `en_préparation` → `prête` → `en_livraison` (livraison seulement) → `remise`. Sorties possibles : `paiement_échoué`, `annulée`, `remboursée`.

## 4. Application client

L'application reprend les sept écrans du prototype, dans cet ordre.

1. **Accueil.** Choix Livraison ou À emporter (un seul affiché si l'autre est désactivé). En livraison : saisie de l'adresse avec suggestions, contrôle de la zone, rappel des frais et du minimum. Choix « Dès que possible » ou « Planifier » ; en planifié, choix du jour puis de l'heure.
2. **Carte.** Logo et nom de l'enseigne, rappel du mode et de l'heure (modifiable), catégories en onglets, produits avec photo, prix et description. Barre panier en bas dès qu'il y a un article.
3. **Fiche produit.** Photo, description, groupes d'options venus de l'API menu, chacun « obligatoire » ou « facultatif » avec un nombre minimum et maximum de choix, suppléments payants, instructions, quantité. Le bouton d'ajout reste grisé tant qu'une option obligatoire manque.
4. **Panier.** Lignes avec options, quantités, bouton « Ajouter des articles », sous-total. Message bloquant si le minimum de livraison n'est pas atteint.
5. **Récapitulatif.** Mode, adresse, heure (modifiables), détail : sous-total, frais de livraison, frais de service s'il y en a, total.
6. **Paiement.** Apple Pay ou Google Pay en premier, carte bancaire ensuite. Écran d'attente pendant le traitement.
7. **Suivi.** Numéro de commande, étapes, heure estimée, mise à jour en temps réel et par notification.

**Règles de gestion**

- Frais de livraison : montant de la zone, ramené à 0 au-dessus du seuil de livraison offerte.
- Créneaux : générés à partir des horaires, du pas (10, 15 ou 30 minutes), du délai de préparation et du nombre maximum de commandes par créneau. Un créneau plein ou passé n'est pas proposé.
- Jours proposés : d'aujourd'hui jusqu'au nombre de jours d'avance réglé ; 0 désactive la planification.
- Restaurant fermé : la carte reste consultable, seule la commande planifiée est possible.
- Produit en rupture ou indisponible dans l'API menu : affiché grisé, non ajoutable.
- Avant paiement, le serveur recontrôle tout : disponibilité, options, prix, créneau, zone, minimum. En cas d'écart, le client revient au panier avec un message clair.
- Compte client : commande possible en invité avec nom, téléphone et e-mail ; connexion par code reçu par e-mail ou SMS pour retrouver adresses et commandes.
- Mentions obligatoires : allergènes accessibles depuis chaque fiche produit, conditions de vente et mentions légales accessibles avant paiement.

**Web et mobile.** Le même code tourne sur le web à l'adresse `enseigne.[DOMAINE]`. Les seules différences admises sont le composant de paiement et les notifications.

## 5. Paiement Stripe

Une commande n'est envoyée à la caisse qu'après confirmation du paiement par Stripe côté serveur, jamais sur la seule foi de l'application.

**Mise en place par restaurant**

- Splash360 est la plateforme Stripe Connect ; chaque restaurant est un compte connecté et le marchand de la vente.
- L'inscription du restaurant se fait depuis le back-office, avec le parcours d'inscription fourni par Stripe (hébergé ou intégré).
- Un restaurant ne peut pas ouvrir la commande en ligne tant que son compte Stripe n'est pas autorisé à encaisser.
- Le modèle de compte et de frais suit la configuration recommandée par Stripe pour une plateforme logicielle à paiements directs ([types de paiements Connect](https://docs.stripe.com/connect/charges), [recommandations d'intégration](https://docs.stripe.com/connect/integration-recommendations)).

**Déroulé d'un paiement**

1. L'application envoie le panier (identifiants et quantités), le mode, l'adresse et l'heure.
2. Le serveur recalcule les montants, crée la commande au statut `en_attente_paiement`, puis crée un paiement Stripe sur le compte du restaurant, avec la commission Splash360 si elle est réglée.
3. L'application affiche la feuille de paiement Stripe et le client paie.
4. Stripe notifie le serveur par webhook. Paiement réussi : la commande passe à `payée` et part vers la caisse. Échec : `paiement_échoué`, le client peut réessayer.
5. L'application passe au suivi quand elle voit le statut `payée`.

**Exigences**

- Aucune donnée de carte ne passe par les serveurs Splash360 : seuls les composants Stripe la manipulent.
- Webhooks vérifiés par signature, traités une seule fois même s'ils arrivent en double.
- Création de paiement protégée contre le double clic (clé d'idempotence par commande).
- Commande restée `en_attente_paiement` plus de 15 minutes : annulée et créneau libéré.
- Remboursement total ou partiel depuis le back-office, tracé dans l'historique de la commande.
- Authentification forte (3-D Secure) gérée par les composants Stripe.
- Environnement de test Stripe pour le développement et la recette, clés de production uniquement dans les secrets du serveur.
- Apple Pay : identifiant marchand Apple déclaré dans la configuration Expo ; domaine web vérifié chez Stripe pour Apple Pay sur le web.

## 6. Back-office

Le back-office sert à Splash360 pour ouvrir et piloter les comptes clients, et à chaque enseigne pour régler sa commande en ligne sans développeur.

**Rôles**

| Rôle | Ce qu'il voit et fait |
|---|---|
| Super-administrateur Splash360 | Toutes les enseignes ; crée, suspend et supprime les comptes ; règle la commission ; se connecte « en tant que » une enseigne pour l'aider |
| Administrateur d'enseigne | Son enseigne et ses restaurants : design, réglages, équipe, commandes, remboursements |
| Équipier | Les commandes de son restaurant : accepter, changer le statut, mettre la commande en ligne en pause |

**Modules**

- **Comptes clients.** Créer une enseigne : nom, sous-domaine, rattachement à son compte Splash360 (pour l'API menu), premier administrateur invité par e-mail. Ajouter ses restaurants.
- **Design.** Envoi du logo, couleur principale, thème clair ou sombre, slogan. Aperçu en direct de l'application à côté du formulaire. Contrôle automatique du contraste : le texte des boutons passe en noir ou en blanc selon la couleur choisie.
- **Carte.** Lecture seule : aperçu de la carte reçue de l'API menu Splash360, bouton « Actualiser », alerte sur les produits sans photo ou sans prix. Seuls réglages locaux : masquer une catégorie ou un produit de la commande en ligne, et ordre d'affichage.
- **Réglages de commande.** Par restaurant : modes actifs, délai de préparation, créneaux, commandes maximum par créneau, jours d'avance, frais de livraison, minimum, seuil de livraison offerte, frais de service, zones de livraison, horaires et fermetures exceptionnelles.
- **Paiement.** État du compte Stripe du restaurant, bouton pour terminer l'inscription, liste des paiements et des virements.
- **Commandes.** Tableau en temps réel (nouvelles, en préparation, prêtes), détail d'une commande, changement de statut, annulation, remboursement total ou partiel, pause de la prise de commande.
- **Clients finaux.** Liste et historique de commandes, export, suppression sur demande.
- **Tableau de bord.** Chiffre d'affaires en ligne, nombre de commandes, panier moyen, répartition Click & Collect et livraison, par jour et par restaurant.
- **Application mobile de l'enseigne.** Nom, icône et écran de démarrage pour les stores, état de publication.

Tout changement de design ou de réglage est visible dans l'application au prochain démarrage, sans nouvelle publication sur les stores.

## 7. Lien avec la caisse, la borne et la cuisine

L'API Splash360 est le point commun : la commande en ligne y lit la carte et y dépose les commandes payées, comme le font déjà la caisse et la borne.

**Lecture de la carte (API menu)**

- Le paquet `packages/api-menu` est le seul endroit du code qui appelle l'API menu ; il traduit sa réponse vers les types internes (catégories, produits, groupes d'options, options, prix, photos, disponibilité, allergènes).
- La carte est mise en cache côté serveur, par restaurant, quelques minutes ; le bouton « Actualiser » du back-office vide ce cache.
- Si l'API menu envoie des notifications de changement (prix, rupture), elles vident le cache immédiatement.
- Si l'API menu ne répond pas : dernière carte connue affichée, commande bloquée si elle date de plus de [DURÉE À FIXER].

**Envoi des commandes**

- À la réception du paiement, le serveur envoie la commande à Splash360 : restaurant, canal « commande en ligne », mode, heure demandée, client, lignes avec identifiants produits et options, montants, mention « déjà payée en ligne ».
- Une commande planifiée est transmise tout de suite avec son heure ; la caisse décide quand l'envoyer en cuisine.
- Envoi réessayé automatiquement en cas d'échec, avec alerte dans le back-office au bout de trois essais.
- Les changements de statut faits sur la caisse ou l'écran cuisine reviennent vers la commande en ligne pour alimenter le suivi client.

**À fournir par Splash360 avant le développement**

- La documentation de l'API menu (idéalement un fichier OpenAPI) et un accès de test.
- Le point d'entrée pour créer une commande dans la caisse, et celui pour recevoir les changements de statut.
- La façon d'identifier une enseigne et un restaurant, et le mode d'authentification.

## 8. Exigences non fonctionnelles

- **Sécurité.** Cloisonnement strict par enseigne dans la base ; secrets (Stripe, API Splash360) uniquement côté serveur ; aucune clé secrète dans l'application ; journal des actions sensibles du back-office (remboursement, suppression, changement de réglage).
- **Données personnelles (RGPD).** Collecte limitée au nécessaire (nom, téléphone, e-mail, adresse) ; consentement séparé pour les messages commerciaux ; export et suppression d'un client sur demande ; hébergement des données dans l'Union européenne.
- **Performance.** Carte affichée en moins de 2 secondes sur un réseau mobile correct ; images redimensionnées et mises en cache ; listes longues fluides.
- **Robustesse.** Perte de réseau gérée à chaque écran avec un message et un bouton « Réessayer » ; le panier survit à la fermeture de l'application.
- **Accessibilité.** Zones tactiles d'au moins 44 points, contrastes lisibles quelle que soit la couleur de l'enseigne, libellés pour les lecteurs d'écran, tailles de texte du système respectées.
- **Notifications.** Notification mobile à chaque changement de statut ; e-mail de confirmation avec le reçu ; SMS en option.
- **Tests.** Tests unitaires sur `packages/core` (prix, frais, minimum, créneaux, options) ; tests d'intégration sur la création de commande et les webhooks Stripe ; un test de bout en bout du parcours complet en environnement de test Stripe.
- **Environnements.** Développement, recette, production, chacun avec sa base, ses clés Stripe et son accès à l'API Splash360.
- **Déploiement.** Builds mobiles par EAS Build, envoi aux stores par EAS Submit, correctifs sans repasser par les stores avec EAS Update ; back-office et version web déployés automatiquement à chaque fusion sur la branche principale ; migrations de base versionnées.
- **Suivi en production.** Remontée des erreurs de l'application et du serveur, alerte si les webhooks Stripe ou l'envoi vers la caisse échouent.

## 9. Lots de livraison

Huit lots, numérotés de 0 à 7, à faire dans l'ordre ; chacun se termine par une démonstration qui valide le critère d'acceptation avant de passer au suivant.

| Lot | Contenu | Critère d'acceptation |
|---|---|---|
| 0. Socle | Monorepo, application Expo vide, back-office vide, base et migrations, intégration continue, trois environnements | Les trois applications démarrent ; les tests et le contrôle de types passent |
| 1. Enseigne et thème | Tables enseigne, restaurant, thème ; chargement de la configuration au démarrage ; thème appliqué partout | Deux enseignes de test s'affichent chacune avec son logo et sa couleur, sans changer le code |
| 2. Carte | Client de l'API menu, cache, écrans Carte et Fiche produit avec options | La carte d'un restaurant de test Splash360 s'affiche avec photos, prix et options obligatoires |
| 3. Commande | Accueil, panier, récapitulatif, règles de `packages/core`, création de commande côté serveur | Une commande planifiée pour le lendemain en livraison est créée avec les bons frais ; les tests de règles passent |
| 4. Paiement | Stripe Connect, inscription d'un restaurant, feuille de paiement mobile et web, webhooks, remboursement | Paiement test par carte, Apple Pay et Google Pay ; la commande ne passe à `payée` que par le webhook ; un remboursement fonctionne |
| 5. Caisse et suivi | Envoi à Splash360, retour des statuts, écran Suivi en temps réel, notifications | Une commande payée apparaît sur la caisse de test ; le changement de statut sur la caisse met à jour le téléphone du client |
| 6. Back-office complet | Tous les modules de la section 6, rôles et droits | Un administrateur d'enseigne change son logo et ses frais de livraison et les voit dans l'application ; il ne voit aucune autre enseigne |
| 7. Publication | Builds par enseigne, fiches stores, version web par sous-domaine, suivi des erreurs | Une enseigne pilote est en ligne sur le web et en test sur TestFlight et Google Play |

## 10. Prompts à coller dans Claude Code

Donnez à Claude Code ce document entier, enregistré dans le dépôt sous `docs/cahier-des-charges.md`, puis avancez lot par lot avec les trois prompts ci-dessous.

**Prompt de démarrage (une seule fois)**

```text
Lis docs/cahier-des-charges.md en entier. C'est la référence du projet.

Avant d'écrire du code :
1. Lis la documentation à jour d'Expo, d'EAS, de @stripe/stripe-react-native et de Stripe Connect.
   Ne te fie pas à ta mémoire pour les versions ni pour les noms d'API.
2. Lis la documentation de l'API menu Splash360 fournie dans docs/api-splash360/.
3. Écris un fichier CLAUDE.md à la racine : commandes pour lancer, tester et vérifier chaque application,
   conventions de code, structure du dépôt, et les règles non négociables ci-dessous.
4. Propose-moi un plan pour le lot 0 et attends ma validation.

Règles non négociables :
- Les prix et les frais sont calculés côté serveur avec packages/core, jamais reçus de l'application.
- Une commande ne passe à "payée" que sur webhook Stripe vérifié.
- Aucune donnée de carte et aucune clé secrète dans l'application.
- Toute table porte l'identifiant de l'enseigne, avec des règles d'accès testées.
- La carte vient uniquement de l'API menu Splash360, via packages/api-menu.
- TypeScript strict, pas de "any". Chaque règle métier a ses tests.
- Tu ne fais qu'un lot à la fois et tu ne commences pas le suivant sans mon accord.
```

**Prompt pour chaque lot**

```text
Fais le lot N du cahier des charges (section 9).
1. Relis les sections concernées et présente ton plan : fichiers créés, tables, écrans, tests.
2. Signale tout ce qui est ambigu ou manquant avant de coder, sans rien inventer.
3. Après validation, développe par petites étapes, avec un commit par étape.
4. Termine en lançant les tests et le contrôle de types, puis montre-moi comment vérifier
   le critère d'acceptation du lot, commande par commande.
```

**Prompt de contrôle en fin de lot**

```text
Relis tout ce que tu as écrit dans ce lot comme un relecteur extérieur.
Cherche : failles de cloisonnement entre enseignes, montants calculés côté application,
webhooks non idempotents, secrets exposés, cas d'erreur réseau non gérés, tests manquants.
Liste ce que tu trouves par gravité, puis corrige.
```

**Documentation à lui faire lire**

- [Expo : intégration Stripe](https://docs.expo.dev/versions/latest/sdk/stripe)
- [Stripe Connect : types de paiements](https://docs.stripe.com/connect/charges)
- [Stripe Connect : paiements directs](https://docs.stripe.com/connect/direct-charges)
- [Stripe Connect : recommandations d'intégration](https://docs.stripe.com/connect/integration-recommendations)
- [Stripe Connect : concevoir une intégration](https://docs.stripe.com/connect/design-an-integration)

Le prototype cliquable sert de référence visuelle : [maquette Click & Collect et livraison](https://claude.ai/artifact/QyBxYCkrA8Dw2FPqWShgd9).

## 11. Points à trancher avant de démarrer

Huit décisions vous reviennent ; les trois premières bloquent le lot 2.

1. **API menu Splash360.** Fournir la documentation et un accès de test. Couvre-t-elle les groupes d'options (obligatoire, minimum, maximum), les photos, les ruptures et les allergènes ? Envoie-t-elle des notifications de changement ?
2. **Commandes vers la caisse.** Existe-t-il déjà un point d'entrée pour créer une commande externe et recevoir les statuts, ou faut-il le développer côté Splash360 ?
3. **Où vivent les données de commande.** Dans une base dédiée (Supabase, choix par défaut de ce document) ou dans le back-end Splash360 existant ? Le second évite une deuxième base mais dépend de votre équipe.
4. **Applications sur les stores.** Une application par enseigne, publiée sous le compte développeur de l'enseigne, ou une seule application Splash360 où l'on choisit son restaurant ? Les règles d'Apple sur les applications issues d'un même modèle sont à vérifier avant de choisir.
5. **Rémunération de Splash360.** Commission par commande prélevée via Stripe, abonnement mensuel, ou les deux ? Cela fixe la configuration Stripe Connect.
6. **Titres-restaurant.** Demander à Stripe s'il accepte en ligne les cartes Swile, Edenred, Pluxee et Up pour vos restaurants ; sinon prévoir un second prestataire.
7. **Livraison.** Confirmer que chaque restaurant livre avec ses propres livreurs en V1, et le découpage des zones (rayon ou codes postaux).
8. **Pays et devise.** Ce document suppose la France et l'euro ; à corriger si d'autres pays sont visés dès la V1.

À prévoir aussi, sans bloquer le démarrage : conditions générales de vente et mentions légales par enseigne, nom de domaine pour les sous-domaines, comptes développeur Apple et Google.
