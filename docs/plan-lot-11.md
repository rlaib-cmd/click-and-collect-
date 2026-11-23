# Lot 11 — Commande façon borne, cadeaux par paliers, compte et codes promo

**Demande** (23/11/2026, captures de l'application Chicken Street) : carte en grille de photos,
points avant le prochain cadeau, paliers de cadeaux au choix avec un pont vers la carte, un vrai
« Mon compte » (historique de commandes, moyens de paiement), code promo avant le paiement.
Décisions du propriétaire : codes promo gérés au back-office ; cartes enregistrées après l'activation de
Stripe ; cadeaux par paliers avec plusieurs produits au choix.

| Étape | Contenu | Statut |
|---|---|---|
| 1 | Carte en grille deux colonnes (photo sur fond blanc, nom, description, prix), onglets de catégories avec vignette, grande photo sur la fiche produit ; photos du site Bills Burger pour toute la carte de démonstration | Livrée |
| 2 | Carte « Ma fidélité » (Accueil, Avantages) : solde, photo du prochain cadeau, « Plus que X points pour débloquer… », jauge, « Continuer mes achats » | Livrée |
| 3 | Paliers de cadeaux au choix (ADR 0014) : Avantages par palier (cartes produits, cadenas et points manquants, « Choisir » → panier ou fiche en mode cadeau) ; choix au récapitulatif ; cadeau retenu dans le panier | Livrée |
| 4 | Mon compte : profil et points, Mes commandes, Mes codes promo, Mes moyens de paiement (écran prêt, cartes avec Stripe), Informations, Déconnexion | Livrée |
| 5 | Historique : `GET /loyalty/me/orders` (membre connecté, pages de 20, jeton de suivi), écran avec état vide, suivi et « Recommander » | Livrée |
| 6 | Codes promo (ADR 0015) : règles, tables, contrôle sous verrou, champ au récapitulatif, page back-office | Livrée |

## Reste à faire

- Modifier son prénom depuis « Mon compte » (dépend de l'API fidélité Splash360).
- Cartes enregistrées (« Mes moyens de paiement ») : avec l'activation de Stripe Connect.
