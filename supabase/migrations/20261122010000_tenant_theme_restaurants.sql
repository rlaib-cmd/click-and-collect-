-- Lot 1 : thème de l'enseigne et points de vente.

create table public.tenant_theme (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  primary_color text not null default '#1F6FEB'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  mode text not null default 'light' check (mode in ('light', 'dark')),
  tagline text check (tagline is null or length(tagline) <= 120),
  updated_at timestamptz not null default now()
);

comment on table public.tenant_theme is 'Design de l''application d''une enseigne (une ligne par enseigne).';

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  splash360_id text not null,
  address_line text not null,
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  city text not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  stripe_account_id text check (stripe_account_id is null or stripe_account_id ~ '^acct_'),
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, splash360_id)
);

comment on table public.restaurants is 'Points de vente d''une enseigne.';

create index restaurants_tenant_id_idx on public.restaurants (tenant_id);

alter table public.tenant_theme enable row level security;
alter table public.restaurants enable row level security;

create trigger tenant_theme_set_updated_at
before update on public.tenant_theme
for each row execute function public.set_updated_at();

create trigger restaurants_set_updated_at
before update on public.restaurants
for each row execute function public.set_updated_at();
