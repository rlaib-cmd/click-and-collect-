# Contrat proposé à Splash360 — commande en ligne ↔ caisse

Proposition de l'équipe Commande en ligne, à valider ou à remplacer par l'API existante de Splash360.
Tant que ce contrat n'est pas validé, l'application utilise une caisse de démonstration (`createDemoPosGateway`).
Le code ne dépend que de deux points : l'interface `PosGateway` (`apps/api/src/pos/gateway.ts`) et la route `POST /v1/pos/status`.

## 1. Lecture de la carte (Splash360 → commande en ligne)

À fournir par Splash360 : documentation (idéalement OpenAPI) et accès de test. Données attendues par restaurant :

| Donnée | Utilisation |
|---|---|
| Catégories (id, nom, ordre) | Onglets de la carte |
| Produits (id, nom, description, prix TTC en centimes, photo, disponible, allergènes, catégorie) | Carte et fiche produit |
| Groupes d'options (id, nom, min, max) et options (id, nom, supplément, disponible) | Composition et contrôle serveur |
| Notification de changement (prix, rupture) — facultatif | Vidage du cache de carte |

## 2. Dépôt d'une commande payée (commande en ligne → Splash360)

`POST {SPLASH360_API_URL}/orders` — authentification par clé d'API serveur (en-tête à définir).

```json
{
  "externalId": "3f1c…",              // identifiant commande en ligne : clé d'idempotence
  "channel": "online_ordering",
  "restaurantId": "S360-R-BELLA-1",    // identifiant Splash360 du point de vente
  "number": 1042,
  "mode": "pickup",                    // ou "delivery"
  "requestedAt": "2026-11-24T11:00:00Z", // null = dès que possible
  "estimatedAt": "2026-11-24T11:00:00Z",
  "paid": true,                        // déjà payée en ligne : rien à encaisser en caisse
  "customer": { "name": "…", "email": "…", "phone": "…" },
  "deliveryAddress": null,
  "lines": [
    { "name": "Margherita", "quantity": 2, "unitPriceCents": 1450, "totalCents": 2900, "note": null,
      "options": [{ "name": "Grande (40 cm)", "priceCents": 400 }] }
  ],
  "totals": { "subtotalCents": 2900, "deliveryFeeCents": 0, "serviceFeeCents": 0, "totalCents": 2900 }
}
```

Réponse attendue : `201 { "reference": "S360-ORD-…" }`. Un second envoi avec le même `externalId` doit renvoyer la même référence (idempotence). Les identifiants produits et options Splash360 seront ajoutés aux lignes dès que la carte réelle sera branchée.

Côté commande en ligne : envoi immédiat après paiement, puis nouveaux essais à 1 min et 5 min ; au 3e échec, alerte dans le back-office avec relance manuelle. Un refus définitif (4xx) n'est pas réessayé.

## 3. Retour des statuts (Splash360 → commande en ligne)

`POST {API_COMMANDE}/v1/pos/status`

- En-tête `x-splash360-signature` : HMAC-SHA256 du corps brut, en hexadécimal, avec un secret partagé (`POS_WEBHOOK_SECRET`, 32 caractères minimum).
- Corps : `{ "reference": "S360-ORD-…", "status": "accepted" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled" }`.
- Réponses : `200` (appliqué, ou déjà dépassé : pas de nouvel envoi nécessaire), `401` signature invalide, `404` référence inconnue, `400` corps invalide.
- Un statut ne fait jamais revenir la commande en arrière ; des étapes peuvent être sautées.

## 4. Identification

- Une enseigne = un `splash360_id` ; un restaurant = un `splash360_id` de point de vente.
- Mode d'authentification de l'API Splash360 à confirmer (clé par enseigne ou clé plateforme).
