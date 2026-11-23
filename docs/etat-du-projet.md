# État du projet — 22 novembre 2026

Synthèse pour reprendre le projet. Détail par lot dans `docs/plan-lot-*.md`, décisions dans `docs/adr/`, questions dans `docs/questions-en-attente.md`.

## Où on en est

| Lot | Statut | Ce qui manque |
|---|---|---|
| 0. Socle | ✅ Terminé | — |
| 1. Enseigne et thème | ✅ Terminé, critère démontré | — |
| 2. Carte | 🟡 Terminé sur carte de démonstration | Documentation + accès de test de l'API menu Splash360 |
| 3. Commande | ✅ Terminé, critère démontré | Texte des CGV par enseigne (saisi au back-office) |
| 4. Paiement | 🟡 Code complet, testé sans réseau Stripe | Compte plateforme Stripe pour le paiement réel en mode test |
| 5. Caisse et suivi | 🟡 Terminé avec caisse de démonstration | Validation du contrat caisse par Splash360, prestataire e-mail |
| 6. Back-office | ✅ Terminé, critère démontré | Projet Supabase Auth pour la connexion réelle |
| 7. Publication | 🟡 Préparation technique terminée | Comptes : domaine, hébergeurs, Supabase, Stripe, Expo, Apple, Google |
| 8. Fidélité, paiement sur place | 🟡 Terminé sur données de test | API fidélité Splash360 |
| 9. Administration de la plateforme | ✅ Terminé (bloquer, supprimer, club fidélité, couleur du club, invitations et mot de passe des administrateurs d'enseigne) | Endpoints d'administration de la fidélité chez Splash360 |
| 10. Connexion du client par code | ✅ Terminé (SMS ou e-mail, inscription avec prénom, téléphone identifiant principal ; Google prêt mais masqué) | Activation des SMS Brevo et clé API ; projet Google ; recherche par téléphone chez Splash360 |
| 11. Commande façon borne, paliers, compte, codes promo | ✅ Terminé (carte en photos, « Ma fidélité », paliers de cadeaux au choix, Mon compte et historique, codes promo au back-office) | Cartes enregistrées avec Stripe ; modifier son prénom (API Splash360) ; paliers chez Splash360 |
| 12. Studio design | ✅ Terminé (brouillon enregistré automatiquement, aperçu téléphone au back-office, lien et QR code d'aperçu dans la vraie application, logo téléversé, publication sans les stores) | Icône, nom et écran de démarrage : nouvelle version sur les stores |
| 13. Studio enseigne et rôles | ✅ Terminé (maquette validée : connexion, accueil, apparence, équipe, console Splash360 ; rôle Gérant ; matrice de droits unique ; 5 parcours de bout en bout back-office ↔ application sur la recette) | Tests mabl à aligner sur les nouveaux écrans |

## Aperçu en ligne (recette)

- Application web : https://claude-splash360.expo.app (enseigne Bills Burger ; `?enseigne=chickenstreet`, `?enseigne=bella` ou `?enseigne=greenbowl` pour les autres).
- API : https://yfrvtrebukdbxnuqhlfy.supabase.co/functions/v1/api (fonction Supabase, ADR 0007 ; `pnpm --filter api build:edge`).
- Back-office : https://claude-splash360--admin.expo.app (export statique, `pnpm --filter admin build:static` puis `eas deploy --export-dir ../admin/out --alias admin` depuis `apps/mobile`). Comptes de test (un par rôle, mot de passe de recette communiqué à part) : `admin@splash360.test`, `proprietaire@billsburger.test`, `gerant@billsburger.test`, `equipier@billsburger.test`, `proprietaire@chickenstreet.test`.
- Android : build EAS `chickenstreet-preview` (distribution interne), APK sur la page du build.
- Paiement désactivé tant que les clés Stripe de test ne sont pas posées en secrets de la fonction.

## Qualité

- **Tests** : 42 règles métier (couverture ≥ 95 % imposée), 64 API (routes, paiement, webhooks, caisse, back-office, durcissement), 26 application, 21 intégration Postgres (dont concurrence sur les créneaux et la file caisse), 12 pgTAP (RLS, cloisonnement), 1 parcours de bout en bout dans un navigateur.
- **CI** à chaque push : mise en forme, lint, types, tests, build back-office, export web, configuration des marques, image Docker, migrations + pgTAP + intégration Postgres, parcours de bout en bout.
- **Sécurité** : montants toujours recalculés par le serveur ; « payée » uniquement par webhook Stripe signé et idempotent ; cloisonnement par enseigne en base (RLS fermée, déclencheurs d'enseigne) et dans chaque requête ; jetons de suivi HMAC ; back-office à rôles avec journal d'audit ; limitation de débit ; export CSV protégé ; aucune clé secrète côté client.

## Ce qu'il me faut pour avancer (par ordre d'impact)

1. **API Splash360** : documentation et accès de test (carte), validation du contrat caisse (`docs/api-splash360/contrat-commande-en-ligne.md`).
2. **Stripe** : compte plateforme avec Connect.
3. **Supabase** : projets recette et production (région UE).
4. **Expo / Apple / Google** et **enseigne pilote** (icône, nom, comptes stores).
5. **Décisions** : rémunération Splash360, application unique ou par enseigne, prestataire e-mail, hébergeur, domaine (liste complète dans `questions-en-attente.md`).

## Démarrer en local

```bash
pnpm install
pnpm db:start && pnpm db:reset      # Docker requis
pnpm --filter api dev                # :8787 (ORDER_TOKEN_SECRET, DATABASE_URL dans apps/api/.env)
pnpm --filter mobile web             # :8081/?enseigne=bella
pnpm --filter admin dev              # :3000 (connexion de développement, voir CLAUDE.md)
```
