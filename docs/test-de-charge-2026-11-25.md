# Test de charge — 25 novembre 2026

Projet Supabase dédié `splash360-test-charge` (`kicssscyymmcfaqlmubi`, Paris), copie du schéma et des
données de démonstration ; ni la recette ni la production n'ont été touchées. Fonction `api` au code
du jour (cache du back-office, verrou de caisse, pooler construit, relance pg_cron toutes les 10 s),
caisse de démonstration (pas de Splash360 réel), pas de Stripe, codes de connexion renvoyés dans la
réponse (aucun SMS).

## Scénarios

Clients simultanés en montée progressive, 60 s par palier, enseigne Bills Burger :

- 75 % « navigation » : config, programme fidélité, carte, disponibilités, créneaux, puis 1,5 à 3 s de pause ;
- 20 % « commande sur place » : inscription au club par code, devis, commande, suivi 3 fois toutes les 4 s ;
  la caisse de démonstration suit par la relance (pending → ready → confirmed) ;
- 5 % « back-office » : /me, commandes, restaurants toutes les 3 à 5 s (compte de staff créé sur ce projet seulement).

L'attente de caisse avant paiement par carte n'a pas pu être chargée : sans Stripe, l'API la saute
(paiement en ligne indisponible). Elle repose sur le même verrou et la même relance que le sur place.

## Résultats (fonction exécutée à Paris, comme pour des clients français)

| Clients | Requêtes | Req/s | p50 | p95 | p99 | Erreurs | Commandes confirmées | Connexions Postgres max (dont pooler) |
|---|---|---|---|---|---|---|---|---|
| 25 | 1 887 | 28 | 182 ms | 353 ms | 663 ms | 0 | 15 / 15 | 23 (16) |
| 50 | 3 621 | 53 | 197 ms | 430 ms | 785 ms | 0 | 30 / 30 | 23 (16) |
| 100 | 6 936 | 95 | 216 ms | 484 ms | 773 ms | 0 | 61 / 61 | 23 (16) |
| 200 | 14 087 | 195 | 212 ms | 478 ms | 719 ms | 0 | 124 / 124 | 23 (16) |
| 400 | 27 343 | 351 | 226 ms | 547 ms | 1,2 s | 0 | 245 / 245 | 23 (16) |

Latences mesurées depuis le client (machine de test aux États-Unis : environ 150 ms de trajet inclus).
Journaux de la fonction : 0 erreur, 0 « too many clients », 0 tâche de fond en échec. Délai commande →
confirmation par la caisse de démonstration : médiane 4,7 s, 95 % sous 13,8 s.

**Conclusion : rien ne casse jusqu'à 400 clients simultanés (≈ 350 requêtes/s, ≈ 250 commandes par
minute).** Le débit croît linéairement, la latence reste stable et la base ne dépasse jamais 23 connexions
sur 60, grâce au pooler. Le palier de rupture n'a pas été atteint dans le budget fixé (≈ 64 000 requêtes
au total).

## Constat sur la région d'exécution

Un premier passage sans forcer la région a fait exécuter la fonction près de la machine de test
(États-Unis) : chaque requête SQL traversait l'Atlantique vers la base de Paris. Résultat : p50 de 2 à
7 s et p95 jusqu'à 24 s dès 50 clients, toujours sans erreur côté base (16 connexions). Des clients en
France n'ont pas ce trajet ; à surveiller seulement pour des clients hors d'Europe.

## Recommandations

1. Garder le pooler (`DATABASE_POOLER_HOST`) en production : c'est lui qui tient les connexions à 16.
2. Les copies de la fonction refont leurs connexions après 3 s d'inactivité ; avec le pooler ce
   renouvellement n'est plus nécessaire et coûte la relecture du catalogue des types (753 appels pendant
   le test). Piste d'optimisation, sans urgence.
3. Le plafond de requêtes par adresse est tenu par copie de la fonction : sous charge il ne s'est jamais
   déclenché. Si une protection globale est voulue, la placer en amont (pare-feu applicatif) ou dans une
   table partagée.
4. Rejouer ce test une fois Stripe live et le paiement par carte en place, pour charger aussi l'attente de caisse.

## Remise à zéro

La relance pg_cron du projet de test a été arrêtée après le test. Pour supprimer le projet :
Supabase → `splash360-test-charge` → Settings → General → Delete project.
