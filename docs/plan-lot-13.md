# Lot 13 — Studio enseigne et rôles

**Demande** (23 novembre) : un vrai outil de paramétrage pour les clients, « simple et sympathique »,
où chaque enseigne règle son application seule, avec un compte qui n'a accès qu'à ça ; une vue
Splash360 qui voit tout ; une page de connexion avec des comptes de test ; des tests qui prouvent
que le back-office et l'application communiquent. Maquette validée :
https://claude.ai/artifact/2oREPNXo5djuiizLpFZPe4 (accueil, apparence, équipe, console).

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Rôle **Gérant** (`manager`) ; matrice de droits unique dans `@splash360/core` (`permissions.ts`), lue par l'API (`allow(c, droit)`) et le back-office (menu, pages, tableau des droits) — ADR 0017 |
| 2 | Équipe : invitation avec le rôle (propriétaire, gérant, équipier) et le restaurant ; changement de rôle par le propriétaire ; invitations en attente et comptes désactivés visibles |
| 3 | Page de connexion (e-mail + mot de passe, « Mot de passe oublié ? ») et panneau « Comptes de test » en recette seulement (`NEXT_PUBLIC_SHOW_TEST_ACCOUNTS=1`) |
| 4 | Studio : coque (tuile de marque, menu selon les droits, carte utilisateur), Accueil (état, brouillon en attente, raccourcis, mise en route calculée, aperçu de l'app), Apparence en 4 étapes (logo, couleurs avec pastilles et contrôle de lisibilité, style, textes) avec aperçu, publication « avant → après » et QR code, Équipe, console Splash360 (filtres, états, « Voir comme le client » avec bandeau, bloquer/débloquer) ; les autres pages reprennent le même style |
| 5 | Comptes de test en recette, un par rôle (Supabase Auth + `staff_users`) |
| 6 | Tests de bout en bout `pnpm e2e:recette` (`e2e/README.md`) : apparence, pause d'un produit, code promo, commande sur place jusqu'aux points, rôles et blocage |

## Ce que voit chaque rôle

| Rôle | Menu |
|---|---|
| Équipier | Commandes, Carte et produits (pause) — son restaurant |
| Gérant | Accueil, Commandes, Apparence, Carte, Fidélité, Codes promo, Restaurants, Tableau de bord, Clients, Journal |
| Propriétaire | Tout le menu du gérant + Équipe et accès, Paiement |
| Splash360 | Console des enseignes, puis le studio de n'importe quelle enseigne (« Voir comme le client ») |

## Constats faits par les tests de bout en bout

- Un code promo désactivé entre le récapitulatif et la commande affichait « Impossible de joindre le
  serveur » : l'application explique maintenant le refus et retire le code.
- Le blocage d'une enseigne (et son déblocage) atteint l'application **dans la minute** : la
  configuration publique est mise en cache 60 secondes, comme pour le design.
