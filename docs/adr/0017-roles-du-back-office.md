# ADR 0017 — Rôles du back-office : propriétaire, gérant, équipier

Date : 2026-11-23 · Statut : acceptée

## Contexte

Le propriétaire de Splash360 veut donner à chaque enseigne un **studio** où elle se paramètre seule
(maquette validée le 23 novembre : accueil, apparence, équipe, console Splash360). Il faut un compte
qui règle l'application sans toucher au compte bancaire ni à l'équipe, et une seule définition des
droits pour l'API et l'interface.

## Décision

1. Quatre rôles (`staff_users.role`) :
   - `super_admin` : Splash360, toutes les enseignes (console, « voir comme le client »).
   - `tenant_admin` (**Propriétaire**) : tout pour son enseigne, y compris paiement et équipe.
   - `manager` (**Gérant**, nouveau) : commandes, carte, horaires, apparence, codes promo, fidélité,
     tableau de bord, clients, journal. Ni paiement, ni équipe. Restaurant principal facultatif.
   - `staff` (**Équipier**) : commandes et pause des produits **de son restaurant** seulement.
2. Les droits sont une matrice pure dans `@splash360/core` (`permissions.ts` : `can(rôle, droit)`,
   `canAssignRole`, `isRestaurantScoped`). L'API (`allow(c, droit)`) et le back-office (menu, pages,
   tableau « Ce que chaque rôle peut faire ») la lisent ; aucune liste de rôles en dur ailleurs.
3. Seuls le propriétaire et Splash360 invitent, changent un rôle ou retirent un compte ; personne ne
   modifie son propre compte ; aucun super-administrateur ne se crée depuis une enseigne.
4. Tests : chaque case de la matrice (core), chaque (rôle, droit) sur une route réelle de l'API
   (403 attendu ou non), contraintes en base (pgTAP), parcours de bout en bout en recette.

## Conséquences

- Ajouter un droit = une ligne dans la matrice, puis la route et l'écran qui l'utilisent.
- Les comptes existants gardent leur rôle ; `gerant@billsburger.test` devient Gérant en recette.
