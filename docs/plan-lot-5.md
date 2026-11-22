# Lot 5 — Caisse et suivi

**Critère d'acceptation (section 9)** : une commande payée apparaît sur la caisse de test ; le changement de statut sur la caisse met à jour le téléphone du client.

Statut : **réalisé avec une caisse de démonstration. Branchement à la caisse Splash360 dès que son API est disponible — contrat proposé : [`api-splash360/contrat-commande-en-ligne.md`](api-splash360/contrat-commande-en-ligne.md).**

## Ce qui a été livré

| Couche | Contenu |
|---|---|
| `packages/core` | Machine à états des statuts : on avance (étapes sautables), jamais en arrière ; « en livraison » réservé à la livraison ; annulation possible jusqu'à la remise |
| Base | `pos_dispatches` (file d'envoi créée **dans la même transaction** que le passage à « payée »), `order_push_tokens`, référence caisse sur la commande |
| `packages/db` | Réservation des envois (`FOR UPDATE SKIP LOCKED`, sûr avec plusieurs instances), échec/abandon/relance, changement de statut contrôlé et tracé, jetons push |
| `apps/api` | Interface `PosGateway` + caisse de démonstration ; envoi immédiat après paiement puis tâche toutes les 15 s ; nouveaux essais à 1 et 5 min, abandon et alerte au 3e échec ; `POST /v1/pos/status` signé HMAC ; notifications push Expo à chaque statut ; e-mail de confirmation avec reçu |
| `apps/mobile` | Écran de suivi rafraîchi toutes les 4 s, étapes selon le mode ; abonnement aux notifications après la commande (iOS/Android) |

## Tests

- 6 tests de la machine à états, 4 tests d'intégration Postgres (réservation unique sous concurrence, abandon et relance, statuts, jetons cloisonnés), 7 tests de bout en bout dans l'API (envoi à la caisse et reçu après paiement, statuts signés, notifications, nouveaux essais, refus définitif).

## Reste à faire

- Adaptateur `PosGateway` réel et validation du contrat avec Splash360.
- Prestataire d'e-mail (journalisé en attendant) et mise en forme HTML du reçu.
- `eas init` pour obtenir le `projectId` Expo nécessaire aux jetons push.
- SMS en option (section 8) : à brancher sur le même service de notification.
