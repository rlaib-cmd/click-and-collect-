# Lot 15 — Ambassadeur (story Instagram)

**Demande** (25 novembre) : « Mets à jour le projet avec la nouvelle fonctionnalité » (maquette
« Deviens ambassadeur Bill's Burger ») et retours du testeur. Décisions : ADR 0019.

## Ce qui est construit

| Étape | Contenu |
|---|---|
| 1 | Base : `ambassador_settings`, `ambassador_entries` (une participation par ticket), RLS, pgTAP ; Bills Burger activé (`billsburgerfr`, 50 points) |
| 2 | API : `GET /v1/tenants/:s/ambassador`, `GET/POST /v1/tenants/:s/ambassador/entries` (membre connecté, débit limité) ; back-office `GET/PUT /v1/admin/ambassador`, `GET /v1/admin/ambassador/entries` ; `confirmAmbassadorEntry` (seul crédit de points, atomique) |
| 3 | Application : carte « Deviens ambassadeur » sur l'accueil, entrée « Tag en Story … et gagne 50 points ;) » dans Avantages, parcours `/ambassadeur` (comment ça marche → ticket → photo avec cadre → story, compte copié sans « @ » → envoyé, en attente) |
| 4 | Back-office : section « Ambassadeur » de la page Fidélité (réglages, participations reçues) |

## Ce qui reste

1. Vérification automatique : mentions Instagram (compte Meta Business, application Meta validée) et
   QR des tickets Splash360 ; puis appel de `confirmAmbassadorEntry`.
2. Nouveau build EAS de l'application installée avec un module d'appareil photo et de composition
   d'image (aujourd'hui : partage d'un texte seulement).
