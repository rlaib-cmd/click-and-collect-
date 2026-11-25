# Lot 17 — Ambassadeur complet

**Demande** (25 novembre) : une seule carte rouge sur l'accueil, compte Instagram mémorisé (case
grisée + « Modifier »), une participation par achat avec un historique complet, crédit 24 h après la
mention avec un contrôle vers 20 h, photo vérifiée (« pas une tour Eiffel »), partage en story
simplifié. Décisions : ADR 0022 (complète l'ADR 0019).

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Base : délais et catégorie par enseigne, étapes et verdict photo des participations, `ambassador_profiles`, `ambassador_events` (même enseigne garantie), RLS, pgTAP |
| 2 | API : `GET/PUT …/ambassador/profile`, `POST …/ambassador/photo-check` (4 Mo, JPEG/PNG/WebP, débit limité, jamais conservée), jeton signé du verdict, étape lisible des participations ; back-office `POST /v1/admin/ambassador/entries/:id/mention`, `/reject`, `/validate` (`loyalty.validate`), historique dans `GET /v1/admin/ambassador/entries`, délais et catégorie dans les réglages |
| 3 | Tâche périodique « ambassadeur » : contrôle à +20 h, crédit à +24 h (réglables), bornée et idempotente ; serveur Node (chaque minute) et Edge (au fil du trafic client) |
| 4 | Analyse par Claude (`ANTHROPIC_API_KEY`), sinon vérification manuelle ; tests avec client HTTP simulé |
| 5 | Application : carte rouge unique, compte mémorisé, consentement, analyse de la photo, « Reprendre la photo » / « Modifier ma photo », « @compte » sur le cadre, « Partager en story Instagram » (compte copié sans « @ »), « Ticket enregistré », étape et date du crédit, historique dans Compte, paragraphe dans les conditions |
| 6 | Back-office : étape, crédit prévu, verdict photo, historique dépliable, « Mention reçue », « Refuser », « Valider maintenant », délais et catégorie |

## Vérifications

- Tests unitaires et de routes (API, application), tests Postgres (`ambassador.integration.test.ts`)
  et pgTAP (`supabase/tests/ambassador_flow_test.sql`) sur une base locale migrée.
- Contrôle visuel de l'export web et du back-office avec l'API locale.

## Ce qui reste

1. Clé `ANTHROPIC_API_KEY` à poser par l'utilisateur (secret de la fonction Edge et du serveur).
2. Meta : lecture des mentions et des stories (`StoryChecker`, « Mention reçue » automatique).
3. Splash360 : vérification du ticket (passer à « Achat vérifié »).
4. Application installée : `expo-sharing`, `expo-clipboard` et module photo, puis nouveau build EAS.
