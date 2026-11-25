# Tests de bout en bout « back-office ↔ application » (recette)

Ces tests vérifient que ce qu'on fait au back-office se voit dans l'application client, et
l'inverse, à travers la **vraie API de recette** (lot 13). Ils ne tournent pas en CI : ils
écrivent dans la recette (brouillon de design, pause d'un produit, code promo, commande sur
place) et remettent tout en place à la fin.

| Scénario       | Ce qui est vérifié                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Apparence  | Le gérant change la couleur du club ; l'aperçu (lien/QR) ouvre la vraie app avec le brouillon, invisible des clients ; « Publier » la rend visible ; retour à la couleur d'origine. |
| (b) Carte      | Un produit mis en pause disparaît de l'app, puis revient.                                                                                                                           |
| (c) Code promo | Un code créé au back-office est accepté au récapitulatif de l'app.                                                                                                                  |
| (d) Commande   | Une commande sur place passée dans l'app apparaît au back-office ; « Accepter → Prête → Remise » se voit dans l'app ; les points sont crédités.                                     |
| (e) Rôles      | Équipier : Commandes et Carte seulement. Gérant : ni Paiement ni Équipe. Propriétaire : tout. Super-admin : bloquer une enseigne coupe son app, « Voir comme le client ».           |

## Lancer

1. Construire et servir les deux interfaces branchées sur la recette :

   ```sh
   # Application client (web), port 4455
   cd apps/mobile && EXPO_PUBLIC_TENANT=billsburger EXPO_PUBLIC_ALLOW_TENANT_OVERRIDE=1 \
     EXPO_PUBLIC_API_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co/functions/v1/api npx expo export -p web
   npx serve dist -l 4455 -s &
   # Back-office, port 4466
   cd ../admin && NEXT_PUBLIC_API_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co/functions/v1/api \
     NEXT_PUBLIC_SUPABASE_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co \
     NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé publiable de la recette> \
     NEXT_PUBLIC_CLIENT_APP_URL=https://claude-splash360.expo.app NEXT_PUBLIC_SHOW_TEST_ACCOUNTS=1 \
     pnpm build:static
   npx serve out -l 4466 &
   ```

2. Lancer les scénarios (mot de passe des comptes de test de la recette, jamais commité) :

   ```sh
   API_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co/functions/v1/api E2E_PASSWORD=… pnpm e2e:recette
   API_URL=… E2E_PASSWORD=… E2E_ONLY=a,e pnpm e2e:recette # une partie
   ```

   `API_URL` est obligatoire : le script ne vise jamais une API distante par défaut. La campagne
   s'arrête à la première erreur et ferme les pages de chaque scénario (aucun appel en fond).
   Autres variables : `ADMIN_URL`, `APP_URL`, `E2E_SHOTS` (captures, `e2e/screenshots` par
   défaut, ignoré par git). Playwright doit être installé sur la machine (`require('playwright')`).

## Comptes de test (recette uniquement)

`admin@splash360.test` (super-admin), `proprietaire@billsburger.test`, `gerant@billsburger.test`,
`equipier@billsburger.test`, `proprietaire@chickenstreet.test`. Le panneau « Comptes de test » de
la page de connexion n'existe que si le back-office est construit avec
`NEXT_PUBLIC_SHOW_TEST_ACCOUNTS=1` : **jamais en production**.
