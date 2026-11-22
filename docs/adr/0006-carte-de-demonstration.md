# 0006 — Carte de démonstration en attendant l'API Splash360

**Statut** : acceptée (2026-11-22), décision du porteur du projet

## Contexte

La documentation et l'accès de test de l'API menu Splash360 ne sont pas disponibles. Le porteur du projet demande d'avancer avec des données virtuelles (compte démo).

## Décision

- L'API sert les cartes de démonstration de `packages/api-menu/src/demo.ts` (`createDemoMenuProvider`), derrière l'interface `MenuProvider`.
- La caisse reste la caisse de démonstration (`createDemoPosGateway`), derrière `PosGateway`.
- Les restaurants de démonstration sont rattachés aux cartes par leur `splash360_id` (`S360-R-BELLA-1`, `S360-R-GREEN-1`) ; une nouvelle enseigne de démonstration ajoute sa carte dans `demo.ts`.

## Conséquences

- Tout le reste (commande, paiement, back-office, publication) avance sans attendre Splash360.
- Le branchement réel se limite à écrire deux adaptateurs et à changer deux lignes dans `apps/api/src/server.ts`. Aucun autre code ne dépend du format de Splash360.
