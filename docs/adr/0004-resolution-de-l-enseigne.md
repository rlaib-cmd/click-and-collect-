# 0004 — Résolution de l'enseigne au démarrage

**Statut** : acceptée (2026-11-22) — à revoir selon la décision « une application par enseigne ou une seule » (section 11)

## Contexte

Un seul code sert toutes les enseignes. L'application doit savoir quelle enseigne afficher avant le premier écran.

## Décision

- **Web** : l'enseigne vient du sous-domaine (`enseigne.<domaine>`).
- **Mobile** : chaque build d'enseigne fixe `EXPO_PUBLIC_TENANT` (profil EAS par enseigne).
- **Développement** : le paramètre d'URL `?enseigne=` (web, hors production) et la variable `EXPO_PUBLIC_TENANT` permettent de basculer d'une enseigne à l'autre.
- L'application charge `GET /v1/tenants/{sous-domaine}/config` (nom, thème) et applique le thème partout ; une enseigne suspendue ou inconnue affiche un écran dédié.

## Conséquences

- Ajouter une enseigne ne demande aucun développement : une ligne en base (web) ou un profil de build (mobile).
- Si Splash360 choisit une application unique sur les stores, seule la résolution mobile change (choix du restaurant au premier lancement).
