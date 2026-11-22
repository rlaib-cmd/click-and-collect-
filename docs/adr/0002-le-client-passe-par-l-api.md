# 0002 — Le client ne lit jamais la base directement

**Statut** : acceptée (2026-11-22)

## Contexte

Supabase permet aux applications de lire la base avec la clé publique, protégée par la RLS. C'est rapide à écrire, mais chaque table devient une surface d'attaque publique, et le format de la base devient un contrat avec des applications installées sur des téléphones qu'on ne peut pas forcer à se mettre à jour.

## Décision

- L'application client (mobile et web) ne parle qu'à `apps/api`, via des contrats versionnés (`/v1/...`) décrits par des schémas zod dans `packages/contracts`.
- La RLS reste activée partout, sans aucune règle pour `anon` : défense en profondeur si la clé publique fuit.
- Le back-office pourra utiliser Supabase Auth et la RLS pour ses propres écrans (lot 6), avec des règles testées.

## Conséquences

- On peut changer le schéma de la base sans casser les applications publiées.
- Cache, limitation de débit et journalisation sont centralisés dans l'API.
- Un saut réseau de plus, compensé par le cache HTTP des réponses publiques (configuration d'enseigne, carte).
