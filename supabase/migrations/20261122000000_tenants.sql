-- Lot 0 : table des enseignes clientes de Splash360.
-- Les autres tables (thème, restaurants, commandes…) arrivent à partir du lot 1
-- et portent toutes une colonne tenant_id.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  subdomain text not null unique
    check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  splash360_id text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is 'Enseignes clientes de Splash360 (une ligne par enseigne).';

-- Accès fermé par défaut : seules les fonctions serveur (rôle service_role) y accèdent.
-- Les règles de lecture par enseigne seront ajoutées avec les comptes du back-office (lot 1 et 6).
alter table public.tenants enable row level security;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();
