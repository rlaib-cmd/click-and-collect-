-- Lot 16 (ADR 0021) : paliers de cadeaux par catégories entières de la carte, et profil du
-- membre complété après l'inscription (prénom, e-mail, date de naissance, tous facultatifs).

-- Catégories de la carte offertes par un palier, réglées par l'enseigne au back-office.
-- Le palier lui-même (points, nom) reste défini par le programme de fidélité Splash360.
create table public.loyalty_reward_settings (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reward_id text not null check (length(reward_id) between 1 and 100),
  category_ids text[] not null default '{}' check (cardinality(category_ids) <= 30),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reward_id)
);
alter table public.loyalty_reward_settings enable row level security;

comment on table public.loyalty_reward_settings is
  'Lot 16 : catégories entières de la carte offertes par un palier (accès serveur uniquement).';

-- Date de naissance facultative (offre d'anniversaire), saisie par le membre.
alter table public.loyalty_demo_members
  add column birth_date date check (birth_date is null or birth_date between '1900-01-01' and current_date);
