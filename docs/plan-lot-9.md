# Lot 9 — Administration de la plateforme

**Demande** : « un administrateur qui me permet de tout faire : supprimer un compte, bloquer une
application, changer les couleurs de l'appli, etc. » (ADR 0011).

## Déjà en place (lot 6)

Rôle super-administrateur, choix de l'enseigne, création d'enseigne, commission, **Design** (couleurs,
logo, style), réglages des restaurants, carte, équipe (inviter, désactiver), clients (export, RGPD), journal.

## Ce qui est ajouté

| Étape | Contenu |
|---|---|
| 1 | Enseignes : « Bloquer / Débloquer l'application » avec confirmation, badge « Bloquée » |
| 2 | Enseignes : « Supprimer l'enseigne » (nom à retaper), refusée si elle a des commandes |
| 3 | Équipe : « Supprimer » un compte (pas le sien, pas un super-administrateur) |
| 4 | Nouvelle page **Club fidélité** : recherche des membres, correction des points avec motif, suppression RGPD |
| 5 | `LoyaltyProvider` : `listMembers`, `adjustPoints`, `deleteMember` ; mouvement `adjust` (migration `20261122090000`) |
| 6 | Design : **couleur du club fidélité** (carte de membre, récompenses, jauge), vide = couleur principale, aperçu et texte lisible calculé (migration `20261122100000`) |
| 7 | Application : écran « Ma carte de membre » centré (titre, nom, code, consigne) |
| 8 | **Autonomie des administrateurs d'enseigne** : invitation par e-mail (Supabase Auth) à la création d'enseigne et d'équipier, « Renvoyer l'invitation », page « Choisir mon mot de passe », « Mot de passe oublié ? » |

## Règles testées

- Suppression d'enseigne : réservée au super-administrateur, 409 si commandes, 404 ensuite, l'application de l'enseigne n'existe plus.
- Blocage : l'application reçoit 403 `tenant_suspended`, puis 200 au déblocage.
- Équipe : 409 sur son propre compte, 404 hors enseigne ou super-administrateur.
- Club : correction nulle refusée (400), solde négatif refusé (409), équipier refusé (403), enseigne sans club (404) ; suppression efface l'historique (pgTAP et intégration Postgres).

- Invitation : envoyée à la création d'enseigne et d'équipier ; un échec n'annule pas le compte
  (`invitationSent: false`, journal `staff.invite_failed`) ; compte déjà existant → lien de
  réinitialisation ; renvoi limité aux comptes de l'enseigne (404 sinon).
- Couleur du club : hexadécimale ou null (contrat, base, pgTAP) ; texte noir ou blanc au contraste ≥ 4,5:1.

## Ce que l'administrateur d'enseigne fait seul

Tout ce qui concerne son enseigne : design et couleur du club, réglages et horaires, carte (masquer,
ordonner), commandes et remboursements, équipe (inviter, désactiver, supprimer, renvoyer l'invitation),
clients (export, RGPD), club fidélité (points, suppression), journal. Restent au super-administrateur
Splash360 : créer, bloquer ou supprimer une enseigne et fixer la commission.

## Statut

Livré : 84 tests API, 5 fidélité, 10 thème, 5 contrats, 25 intégration Postgres, 21 pgTAP. Migrations appliquées en recette.
