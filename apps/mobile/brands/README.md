# Marques (une par enseigne publiée sur les stores)

Chaque fichier `<sous-domaine>.json` décrit l'application d'une enseigne : nom sur les stores, identifiants, couleurs, icônes.
Le build choisit la marque avec la variable `BRAND` (voir `app.config.ts` et les profils de `eas.json`).

Champs : `name`, `subdomain` (enseigne servie, = `EXPO_PUBLIC_TENANT`), `iosBundleIdentifier`, `androidPackage`,
`scheme` (liens profonds), `primaryColor` (écran de démarrage, icône Android), `appleMerchantId` (Apple Pay),
`icon` et `splash` (chemins d'images 1024×1024, facultatifs — l'icône Splash360 par défaut sinon).

Ajouter une enseigne : copier un fichier, l'adapter, ajouter les profils `<marque>-preview` et `<marque>-production` dans `eas.json`.
