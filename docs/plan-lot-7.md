# Lot 7 — Publication

**Critère d'acceptation (section 9)** : une enseigne pilote est en ligne sur le web et en test sur TestFlight et Google Play.

Statut : **préparation technique terminée ; la mise en ligne demande les comptes (hébergement, domaine, Supabase, Stripe, Expo, Apple, Google).** Procédure complète : [`mise-en-production.md`](mise-en-production.md).

## Ce qui a été livré

| Sujet | Contenu |
|---|---|
| Builds par enseigne | `apps/mobile/app.config.ts` + `brands/<enseigne>.json` (nom, identifiants iOS/Android, schéma de liens, couleur, identifiant Apple Pay) ; profils EAS `bella-*`, `greenbowl-*` ; marque inconnue refusée ; contrôlé en CI |
| Web par sous-domaine | Une seule build statique pour toutes les enseignes (enseigne lue dans le sous-domaine) |
| Image de l'API | Bundle unique (esbuild) exécuté par Node 22, image Alpine sans outils de développement, utilisateur non privilégié, `HEALTHCHECK` sur `/ready` ; construite en CI |
| Durcissement | Limitation de débit (commande, paiement, devis : 20/min/IP ; lectures : 300/min/IP), corps limité à 256 Ko, identifiant de requête, journaux JSON sans données personnelles, `/ready`, Sentry facultatif |

## Reste à faire (avec les comptes)

1. Domaine et hébergements (API, back-office, web statique avec joker).
2. Projets Supabase recette/production, migrations, premier super-administrateur.
3. Compte plateforme Stripe et webhook Connect.
4. `eas init`, comptes Apple Developer et Google Play de l'enseigne pilote, `eas build` + `eas submit`.
5. Icônes et écrans de démarrage de l'enseigne pilote (1024×1024).
