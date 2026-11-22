# Environnement de recette

Valeurs **publiques** de l'environnement de recette (aucun secret ici : les secrets vont dans les variables d'environnement de l'hébergeur).

## Supabase

| Élément | Valeur |
|---|---|
| Projet | `splash360-commnde-recette` — référence `yfrvtrebukdbxnuqhlfy`, organisation Splash 360, région `eu-west-3` (Paris), Postgres 17 |
| URL | `https://yfrvtrebukdbxnuqhlfy.supabase.co` |
| Clé publiable | `sb_publishable_S6sTwCD5rcnrtR5gk-SInQ_2KwqX64e` |
| JWKS (vérification des sessions par l'API) | `https://yfrvtrebukdbxnuqhlfy.supabase.co/auth/v1/.well-known/jwks.json` (clés ES256) |
| Émetteur des jetons | `https://yfrvtrebukdbxnuqhlfy.supabase.co/auth/v1` |

État au 2026-11-22 : les 6 migrations de `supabase/migrations/` sont appliquées, ainsi que les données de démonstration (`seed.sql`). Contrôles : 18 tables, toutes avec RLS et `tenant_id`, aucune règle d'ouverture. L'audit Supabase signale « RLS activée sans règle » sur chaque table : c'est voulu (ADR 0002, tout passe par l'API).

### Variables à renseigner

**API (`apps/api`)**

```
DATABASE_URL=postgresql://postgres.yfrvtrebukdbxnuqhlfy:<mot de passe de la base>@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
SUPABASE_JWKS_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_ISSUER=https://yfrvtrebukdbxnuqhlfy.supabase.co/auth/v1
```

Le mot de passe de la base a été choisi à la création du projet (Supabase › Project Settings › Database) ; l'hôte exact du pooler est affiché sur le bouton « Connect » du projet.

**Back-office (`apps/admin`)**

```
NEXT_PUBLIC_SUPABASE_URL=https://yfrvtrebukdbxnuqhlfy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_S6sTwCD5rcnrtR5gk-SInQ_2KwqX64e
```

### Premier super-administrateur

1. Supabase › Authentication › Users › « Add user » : votre e-mail et un mot de passe (cocher « Auto confirm »).
2. Dans le SQL Editor : `insert into public.staff_users (email, role) values ('<votre e-mail en minuscules>', 'super_admin');`
3. Connexion au back-office avec cet e-mail : le compte est rattaché automatiquement.

## Stripe (mode test)

- Compte plateforme `acct_1DaN…` (France). Clé secrète de test enregistrée comme secret réseau de l'environnement cloud `click-and-collect` (jamais dans le dépôt).
- Paiement de test de 18,00 € par carte Visa de test puis remboursement : OK (2026-11-22).
- **À faire** : activer Stripe Connect (dashboard.stripe.com/test/connect) pour créer les comptes des restaurants.
