-- Lot 6 : back-office (ADR 0005).

-- Comptes du back-office. Le super-administrateur Splash360 n'appartient à aucune enseigne.
create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  -- Rattaché à la première connexion (identifiant Supabase Auth).
  auth_user_id uuid unique,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  role text not null check (role in ('super_admin', 'tenant_admin', 'staff')),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  check ((role = 'super_admin') = (tenant_id is null)),
  check (role <> 'staff' or restaurant_id is not null)
);
create unique index staff_users_email_tenant_idx on public.staff_users (email, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'));

-- Journal des actions sensibles (section 8). tenant_id null = action de plateforme.
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants (id) on delete cascade,
  actor_id uuid references public.staff_users (id) on delete set null,
  actor_email text not null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs (tenant_id, created_at desc);

-- Réglages locaux de la carte : masquer, ordonner (la carte elle-même reste dans Splash360).
create table public.menu_overrides (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_kind text not null check (item_kind in ('category', 'product')),
  item_id text not null,
  hidden boolean not null default false,
  position integer,
  primary key (restaurant_id, item_kind, item_id)
);

-- Conditions générales de vente et mentions légales, par enseigne.
alter table public.tenants add column legal_text text check (legal_text is null or length(legal_text) <= 50000);

alter table public.staff_users enable row level security;
alter table public.audit_logs enable row level security;
alter table public.menu_overrides enable row level security;

create trigger menu_overrides_same_tenant before insert or update on public.menu_overrides
for each row execute function public.check_same_tenant();

-- Une zone remplacée mais déjà utilisée par une commande est archivée, pas supprimée.
alter table public.delivery_zones add column archived boolean not null default false;
