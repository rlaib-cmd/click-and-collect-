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

- **Autonomie des administrateurs d'enseigne** : à la création d'une enseigne (premier
  administrateur) ou d'un compte d'équipe, l'API demande à Supabase Auth d'envoyer une invitation
  (`POST /auth/v1/invite`, clé de service côté serveur uniquement, `redirect_to` vers
  `/mot-de-passe/` du back-office). Si le compte Auth existe déjà, un lien de réinitialisation
  (`/auth/v1/recover`) part à la place. L'échec d'envoi n'annule pas le compte : il est signalé et
  l'invitation peut être renvoyée depuis la page Équipe. Le back-office ne reçoit que la clé publiable.
- **Couleur du club fidélité** : colonne `tenant_theme.loyalty_color` (null = couleur principale),
  réglée dans Design ; `packages/theme` calcule le texte lisible dessus.

## Conséquences

- La suppression d'une enseigne efface en cascade restaurants, thème, équipe, réglages, journal et
  membres de démonstration ; elle est irréversible.
- Les clients qui commandent (table `customers`) gardent leur suppression RGPD existante (anonymisation).
- Les e-mails d'invitation passent par l'expéditeur de Supabase Auth : limité en débit sur
  l'expéditeur intégré, il faut un SMTP personnalisé (Brevo) en production, et l'URL
  `…/mot-de-passe/` du back-office dans les URL de redirection autorisées.

## Statut

Acceptée (lot 9).
