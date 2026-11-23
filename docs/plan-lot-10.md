# Lot 10 — Connexion et inscription du client par code

**Demande** : « création de compte, se connecter sur l'application client… numéro de tél → code,
Gmail… pour qu'on récupère les points du client ». Choix : SMS par Brevo, client reconnu surtout par
son téléphone, Google plus tard (ADR 0012).

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | `core/otp.ts` : normalisation du téléphone (E.164), code, durée, essais, limites d'envoi, expéditeur SMS |
| 2 | Migration `20261123000000_customer_otp.sql` : codes envoyés (RLS), téléphone unique et e-mail facultatif des membres |
| 3 | `api-loyalty` : `findByPhone`, adhésion par téléphone ou e-mail ; `db` : stockage Postgres des codes |
| 4 | API : `POST /loyalty/otp/start` et `/loyalty/otp/verify`, SMS Brevo, aide au test en recette |
| 5 | Application : écran numéro → code → prénom, renvoi minuté, code par e-mail, emplacement Google masqué |
| 6 | Back-office : téléphone des membres dans « Club fidélité », recherche par numéro |
| 7 | E-mail facultatif à la commande (clé client e-mail sinon téléphone), explication sous le bouton grisé (ADR 0013) |
| 8 | Points du cadeau réservés tant que la commande est en cours, débités à la validation (ADR 0013) |

## Statut

Livré et testé : core 75 tests, API 97 (dont 13 sur la connexion par code), api-loyalty 6, intégration
Postgres 27, pgTAP 29 (dont 8 nouveaux). Recette déployée (fonction `api`, application web, back-office)
et parcours vérifié dans un navigateur iPhone contre l'API en ligne : inscription par code, carte de
membre, déconnexion, reconnexion avec un nouveau code sur le même compte.

## Reste à faire (utilisateur)

- Brevo : activer les SMS sur le compte, acheter des crédits, puis donner la clé API par le formulaire
  sécurisé. Tant que la clé manque, la recette affiche le code de test à l'écran (« Recette : code de test »).
- Google : créer le projet Google Cloud (écran de consentement, identifiants OAuth) pour activer le bouton.
- Splash360 : recherche d'un membre par téléphone, création avec téléphone (voir `questions-en-attente.md`).

## Tests mabl

La connexion de test par e-mail reste en recette derrière le lien « Recette : connexion de test par
e-mail, sans code » : les tests qui se connectent avec `mabl-test@billsburger.test` doivent d'abord
cliquer ce lien (le formulaire d'adhésion n'est plus l'écran par défaut).
