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

## Règles testées

- Suppression d'enseigne : réservée au super-administrateur, 409 si commandes, 404 ensuite, l'application de l'enseigne n'existe plus.
- Blocage : l'application reçoit 403 `tenant_suspended`, puis 200 au déblocage.
- Équipe : 409 sur son propre compte, 404 hors enseigne ou super-administrateur.
- Club : correction nulle refusée (400), solde négatif refusé (409), équipier refusé (403), enseigne sans club (404) ; suppression efface l'historique (pgTAP et intégration Postgres).

## Statut

Livré : 79 tests API, 5 fidélité, 25 intégration Postgres, 19 pgTAP. Migration appliquée en recette.
