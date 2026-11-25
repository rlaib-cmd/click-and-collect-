-- Lot 22 (ADR 0027) : notifications « Bons plans à proximité » (zones autour des restaurants).
-- Trois tables, lues et écrites par le serveur uniquement (RLS active, aucune politique).
-- Aucune position n'est enregistrée : seulement le restaurant dont le membre est entré dans la zone.

-- Règles de l'enseigne. Fonction désactivée par défaut.
create table public.proximity_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  radius_meters integer not null default 200 check (radius_meters between 100 and 1000),
  title text not null check (length(trim(title)) between 1 and 65),
  body text not null check (length(trim(body)) between 1 and 178),
  deep_link text not null default 'commander' check (deep_link in ('home', 'commander', 'avantages')),
  only_opening_hours boolean not null default true,
  quiet_start time,
  quiet_end time,
  member_cap_hours integer not null default 24 check (member_cap_hours between 1 and 720),
  restaurant_cap_hours integer not null default 168 check (restaurant_cap_hours between 1 and 2160),
  target text not null default 'all' check (target in ('all', 'reward', 'inactive')),
  inactive_days integer not null default 30 check (inactive_days between 1 and 365),
  updated_at timestamptz not null default now(),
  check ((quiet_start is null) = (quiet_end is null)),
  check (quiet_start is null or quiet_start <> quiet_end)
);
alter table public.proximity_settings enable row level security;
comment on table public.proximity_settings is
  'Lot 22 : règles des notifications à proximité de l''enseigne ; serveur uniquement.';

-- Appareils des membres qui ont donné leur accord dans l'application. Supprimés au retrait de
-- l'accord ou à la déconnexion.
create table public.proximity_devices (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expo_push_token text not null check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  member_id text not null check (member_id ~ '^([0-9a-f-]{36}|[0-9]{1,18})$'),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, expo_push_token)
);
create index proximity_devices_member_idx on public.proximity_devices (tenant_id, member_id);
alter table public.proximity_devices enable row level security;
comment on table public.proximity_devices is
  'Lot 22 : appareils inscrits aux notifications à proximité (accord du membre) ; serveur uniquement.';

-- Décisions du serveur (plafonds et statistiques). Pas d'historique de position : membre,
-- restaurant, instant, décision. Purgé au bout de 90 jours par la tâche périodique de l'API.
create table public.proximity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  member_id text not null check (member_id ~ '^([0-9a-f-]{36}|[0-9]{1,18})$'),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  decision text not null check (decision in ('sent', 'skipped', 'failed')),
  reason text not null check (reason in (
    'sent', 'disabled', 'no_device', 'restaurant_unavailable', 'quiet_hours', 'closed',
    'member_cap', 'restaurant_cap', 'no_reward', 'loyalty_unavailable', 'recently_active',
    'push_failed'
  )),
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  check (decision <> 'sent' or reason = 'sent'),
  check (opened_at is null or decision = 'sent')
);
create index proximity_events_member_idx
  on public.proximity_events (tenant_id, member_id, created_at desc) where decision = 'sent';
create index proximity_events_tenant_idx on public.proximity_events (tenant_id, created_at desc);
create index proximity_events_restaurant_id_idx on public.proximity_events (restaurant_id);
create index proximity_events_created_idx on public.proximity_events (created_at);
alter table public.proximity_events enable row level security;
comment on table public.proximity_events is
  'Lot 22 : décisions d''envoi (sans position), conservées 90 jours ; serveur uniquement.';

-- Le restaurant appartient à la même enseigne (fonction commune du lot 6).
create trigger proximity_events_same_tenant before insert or update on public.proximity_events
for each row execute function public.check_same_tenant();
