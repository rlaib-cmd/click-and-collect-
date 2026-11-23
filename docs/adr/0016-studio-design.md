# ADR 0016 — Studio design : brouillon, aperçu, publication

Date : 2026-11-23 · Statut : acceptée

## Contexte

Le propriétaire veut que chaque enseigne règle elle-même le look de son application (couleurs, logo,
style) au back-office, **voie le résultat avant** qu'il n'arrive chez les clients, et que la mise à jour
se fasse **sans republier l'application sur les stores**. Le design est déjà lu au démarrage de
l'application (`GET /v1/tenants/{enseigne}/config`, ADR 0004 et 0008) : il manquait le brouillon,
l'aperçu fidèle et le téléversement du logo.

## Décision

1. **Brouillon** : colonne `tenant_theme.draft` (objet JSON, mêmes réglages que la version publiée,
   validé par le contrat `tenantThemeSchema` à chaque lecture). L'application ne lit que les colonnes
   publiées. Le back-office enregistre le brouillon automatiquement (`PUT /admin/theme/draft`) ;
   `POST /admin/theme/publish` copie le brouillon dans la version publiée et l'efface, en une
   transaction, et journalise `theme.publish` avec la liste des réglages changés (`themeChanges`,
   `@splash360/theme`) ; `POST /admin/theme/discard` revient à la version publiée.
2. **Aperçu au back-office** : un cadre de téléphone (Accueil, Carte, Carte VIP, Avantages) rendu en
   HTML à partir du brouillon avec les **mêmes règles** que l'application (`buildPalette`, contraste
   automatique, angles, titres) et la vraie carte et les vrais paliers de l'enseigne (API publique).
3. **Aperçu dans la vraie application** : `POST /admin/theme/preview-link` signe un jeton
   `<expiration>.<HMAC>` propre à l'enseigne, valable 30 minutes (clé dérivée du secret des jetons,
   distincte). `config?preview=<jeton>` renvoie le brouillon (`preview: true`, `Cache-Control: no-store`)
   si le jeton est valide pour cette enseigne ; sinon la version publiée, **sans erreur** (rien ne fuit).
   L'application web lit `?preview=` au démarrage, le garde pour l'onglet et affiche un bandeau.
   Lien et QR code au back-office pour l'ouvrir sur un téléphone.
4. **Logo téléversé** : `POST /admin/theme/logo` (corps brut, 2 Mo au plus). Le format est lu dans les
   premiers octets (PNG, JPEG, WebP) ; **le SVG est refusé** (il peut contenir du script). Fichier rangé
   dans le bucket public Supabase Storage `brand-assets`, sous `<tenant_id>/logo-<empreinte>.<ext>`
   (nom tiré du contenu : pas d'écrasement, cache long sûr), écrit par le serveur avec la clé de service,
   jamais par le navigateur. L'adresse obtenue va dans le brouillon.

## Ce qui se met à jour sans les stores

Logo, couleurs, style, slogan, carte, fidélité, codes promo, textes légaux : au prochain chargement de
l'application (la configuration publique est mise en cache 60 secondes au plus). L'icône, le nom sous
l'icône et l'écran de démarrage sont dans le binaire : ils demandent une nouvelle version sur les stores.

## Conséquences

- Les applications natives déjà installées appliquent le design publié sans mise à jour ; le lien
  d'aperçu, lui, ouvre la version web (le binaire n'a pas d'adresse à paramètres).
- `PUT /admin/theme` (publication directe) reste disponible pour l'outillage et les tests.
