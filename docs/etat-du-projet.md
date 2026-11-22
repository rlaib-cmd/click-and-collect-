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
