# ADR 0013 — E-mail facultatif à la commande, points du cadeau réservés

Date : 2026-11-23 · Statut : acceptée

## Contexte

Depuis le lot 10, le client se connecte par son téléphone ; beaucoup de membres n'ont pas d'e-mail.
Le récapitulatif exigeait pourtant un e-mail, et le bouton « Commander » restait grisé sans explication.

Règle du propriétaire : les points d'un cadeau sont débités seulement quand la commande est validée
(payée en ligne, ou retirée et encaissée pour le paiement sur place). Entre-temps, rien n'empêchait de
reprendre le même cadeau sur une deuxième commande.

## Décision

1. **E-mail facultatif.** Le client final est identifié dans l'enseigne par une clé
   `customers.contact_key` : `email:<e-mail>` s'il en donne un, sinon `tel:<téléphone>` (format
   international pour un mobile français), `supprime:<id>` après effacement RGPD. La clé est calculée
   par `@splash360/core` (`customerContactKey`) ; un déclencheur la déduit pour les insertions directes.
   Sans e-mail, aucun reçu par e-mail n'est envoyé (le suivi reste dans l'application et le QR code).
   Le récapitulatif affiche sous le bouton la première chose qui manque (nom, téléphone, e-mail mal
   saisi, connexion au club pour payer sur place, CGV).
2. **Points réservés, pas débités.** Les points du cadeau d'une commande en cours (payée, confirmée,
   acceptée, en préparation, prête, en livraison ; impayée depuis moins de 30 min) sont réservés :
   ils ne peuvent pas servir à un autre cadeau (`reservedRewardPoints`, `availablePoints`). Le débit
   chez Splash360 ne change pas (paiement en ligne, ou remise pour le paiement sur place). Annulation,
   remboursement, échec de paiement ou remise libèrent la réservation. Le rejeu d'une même commande
   (même clé d'idempotence) ne se compte pas lui-même. L'application affiche
   « dont X pts réservés pour ta commande en cours ».

## Conséquences

- Un client qui commande tantôt avec, tantôt sans e-mail peut avoir deux fiches clients ; elles
  restent dans la même enseigne et la liste « Clients » du back-office les montre toutes les deux.
- Deux commandes envoyées au même instant peuvent encore passer le contrôle toutes les deux ; le
  débit chez Splash360 refuse alors la seconde (solde insuffisant), comme avant.
