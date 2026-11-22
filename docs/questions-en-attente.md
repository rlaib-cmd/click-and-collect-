# Questions en attente de réponse

Tenu à jour pendant le développement autonome. Chaque point indique ce qu'il bloque et le choix provisoire retenu.

| # | Question | Bloque | Choix provisoire |
|---|---|---|---|
| 1 | ~~Documentation et accès de test de l'API menu Splash360~~ — **tranché : données de démonstration pour l'instant (ADR 0006)** (groupes d'options, photos, ruptures, allergènes, notifications de changement) | Fin du lot 2 | Cartes de démonstration derrière l'interface `MenuProvider` |
| 2 | Point d'entrée pour créer une commande dans la caisse et recevoir les statuts | Lot 5 | Interface `PosGateway` avec faux en mémoire |
| 3 | Durée maximale d'une carte servie quand l'API menu est en panne | Robustesse lot 2 | 60 min (`MENU_MAX_STALE_MINUTES`) |
| 4 | Une application par enseigne sur les stores, ou une seule ? | Lot 7 | Une par enseigne (ADR 0004) |
| 5 | Rémunération Splash360 : commission par commande, abonnement, ou les deux ? | Lot 4 (configuration Stripe) | Commission paramétrable par enseigne, 0 par défaut |
| 6 | Frais de service : montant fixe ou pourcentage ? | Lot 3 | Montant fixe par restaurant |
| 7 | Les commandes « dès que possible » comptent-elles dans le maximum par créneau ? | Lot 3 | Non : seules les commandes planifiées réservent un créneau |
| 8 | Hébergement de `apps/api` (région UE) et nom de domaine des sous-domaines | Lot 7 | — |
| 10 | Commission Splash360 remboursée au prorata en cas de remboursement ? | Lot 4 | Oui (`refund_application_fee`) : le restaurant ne paie pas de commission sur ce qu'il rembourse |
| 9 | Compte Expo/EAS, comptes Apple et Google, compte Stripe plateforme | Lots 4 et 7 | Mode test Stripe, sans build natif |
| 11 | Prestataire d'e-mail transactionnel (Brevo, Postmark, Resend…) et domaine d'envoi par enseigne | Lot 5 (reçu par e-mail) | E-mails journalisés, non envoyés |
| 12 | Validation du contrat caisse proposé (`docs/api-splash360/contrat-commande-en-ligne.md`) | Lot 5 | Caisse de démonstration |
| 13 | Projets Supabase (recette, production) et activation de Supabase Auth pour le back-office | Lot 6 (connexion réelle) | Connexion de développement locale |
| 14 | Nom de domaine des enseignes (`<enseigne>.<domaine>`) et hébergeurs retenus | Lot 7 | Recommandations dans `mise-en-production.md` |
| 15 | Enseigne pilote, ses comptes Apple Developer / Google Play, icône et écran de démarrage | Lot 7 | Marques de démonstration `bella`, `greenbowl` |
