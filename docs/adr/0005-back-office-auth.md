# 0005 — Authentification et droits du back-office

**Statut** : acceptée (2026-11-22)

## Contexte

Le back-office sert trois rôles (section 6) : super-administrateur Splash360 (toutes les enseignes), administrateur d'enseigne, équipier d'un restaurant. Il manipule des données sensibles (remboursements, données clients) et doit être journalisé (section 8).

## Décision

- **Identité** : Supabase Auth (e-mail + mot de passe ou lien magique ; double authentification activable). Le back-office ne fait qu'obtenir un jeton de session.
- **Droits** : table `staff_users` (compte, rôle, enseigne, restaurant pour un équipier). Toutes les données passent par `apps/api` (`/v1/admin/*`), qui vérifie la signature du jeton Supabase (JWKS, ou secret HS256 en local) puis applique le rôle. Le back-office n'interroge jamais la base directement (cohérent avec l'ADR 0002).
- **Invitation** : un administrateur crée un compte par e-mail ; le rattachement se fait à la première connexion par l'e-mail vérifié.
- **« Se connecter en tant que »** : le super-administrateur choisit une enseigne ; chaque requête porte l'enseigne visée et chaque action est journalisée avec son auteur réel.
- **Journal** : table `audit_logs` (auteur, enseigne, action, cible, détail) pour remboursements, annulations, réglages, design, comptes, suppressions.

## Conséquences

- Un seul point de contrôle des droits, testé sans Supabase (jetons signés en test).
- Pas de règle RLS à maintenir pour le back-office ; la RLS reste fermée partout.
- Le back-office dépend de la disponibilité de Supabase Auth pour la connexion uniquement.
