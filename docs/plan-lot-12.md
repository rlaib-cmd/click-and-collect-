# Lot 12 — Studio design

**Demande** : un back-office pour gérer l'application de l'enseigne (couleurs, logo, style) avec
**aperçu avant mise à jour**, et une mise à jour **sans republier l'application** sur les stores.
Décisions : ADR 0016.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | `@splash360/theme` : `themeChanges` (réglages modifiés entre version publiée et brouillon) |
| 2 | Base : `tenant_theme.draft` (+ date), bucket public `brand-assets` (Supabase Storage) |
| 3 | API : brouillon (`GET/PUT /admin/theme/draft`), publication, annulation, lien d'aperçu signé (30 min), logo téléversé (PNG/JPEG/WebP, 2 Mo, SVG refusé) |
| 4 | `config?preview=` : brouillon si le jeton vaut pour l'enseigne, sinon version publiée sans erreur |
| 5 | Back-office, page Design : formulaire + aperçu téléphone (Accueil, Carte, Carte VIP, Avantages) en direct, brouillon enregistré automatiquement, badge « Brouillon non publié », « Publier » avec la liste des changements, « Annuler les modifications », lien + QR code d'aperçu, encadré « instantané / stores » |
| 6 | Application web : `?preview=` lu au démarrage, bandeau « Aperçu du brouillon — non publié » |

## Tests

Règles `themeChanges` (4), jeton d'aperçu (5), contrôle du logo (4), routes du studio (9, dont
cloisonnement, jeton d'une autre enseigne, jeton expiré, SVG refusé, 2 Mo), brouillon Postgres
(intégration), pgTAP `theme_draft_test` (5), application : jeton transmis et filtré (2).

## Ce qui se met à jour sans les stores

Instantané (dans la minute) : logo, couleurs, style, slogan, carte, fidélité, codes promo, textes
légaux. Nouvelle version sur les stores : icône, nom sous l'icône, écran de démarrage.

## Configuration

- API : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (déjà fournis à la fonction Supabase) pour le
  stockage des logos ; sans eux, seul le champ « adresse du logo » fonctionne.
- Back-office : `NEXT_PUBLIC_CLIENT_APP_URL` = adresse web de l'application client (lien d'aperçu).
