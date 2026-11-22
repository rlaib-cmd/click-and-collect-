# 0011 — Administration de la plateforme

## Contexte

Le responsable produit veut un administrateur qui peut tout faire depuis le back-office : bloquer
l'application d'une enseigne, la supprimer, changer ses couleurs, gérer les comptes de l'équipe et
ceux des clients du club fidélité. Le rôle `super_admin` (ADR 0005) existait déjà, avec le choix de
l'enseigne, le design, les réglages, l'équipe et les clients.

## Décision

- **Bloquer l'application** = statut `suspended` de l'enseigne (déjà refusé par l'API, l'application
  affiche « enseigne suspendue »). Bouton explicite avec confirmation, badge « Bloquée ».
- **Supprimer une enseigne** (super-administrateur seul) : uniquement si elle n'a **aucune commande**.
  Les commandes sont des pièces comptables à conserver ; une enseigne qui a vendu se bloque, elle ne
  se supprime pas. Confirmation en retapant le nom exact. Journalisé au niveau plateforme
  (`tenant_id` nul, le journal de l'enseigne disparaissant avec elle).
- **Supprimer un compte de l'équipe** (administrateurs) : jamais le sien, jamais un super-administrateur,
  seulement dans l'enseigne courante. La désactivation reste possible.
- **Club fidélité** (administrateurs) : liste et recherche des membres, correction manuelle des points
  avec motif (mouvement `adjust`, solde jamais négatif), suppression du compte (RGPD, historique
  effacé). Tout passe par `LoyaltyProvider` (`packages/api-loyalty`) : avec l'API Splash360, ces
  opérations seront des appels à Splash360 (endpoints demandés dans `questions-en-attente.md`).
- Chaque action est journalisée (`tenant.delete`, `staff.delete`, `loyalty.adjust`, `loyalty.member.delete`).

## Conséquences

- La suppression d'une enseigne efface en cascade restaurants, thème, équipe, réglages, journal et
  membres de démonstration ; elle est irréversible.
- Les clients qui commandent (table `customers`) gardent leur suppression RGPD existante (anonymisation).

## Statut

Acceptée (lot 9).
