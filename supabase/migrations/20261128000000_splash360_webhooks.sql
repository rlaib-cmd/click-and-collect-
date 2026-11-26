-- Lot 23 (ADR 0029) : réception des webhooks Splash360 (disponibilité, prix de livraison,
-- mise à jour du catalogue, encaissement / annulation de commande).

-- 1. Station click and collect Splash360 du restaurant : dernier segment du chemin des webhooks
-- (identifiant client de la station, de la forme « 123_4abc5def »). Une station = un restaurant.
-- Réglée par le super-administrateur au back-office.
alter table public.restaurants
  add column splash360_station_id text
    check (splash360_station_id is null or splash360_station_id ~ '^[A-Za-z0-9_.-]{1,100}$');
create unique index restaurants_splash360_station_id_key
  on public.restaurants (splash360_station_id) where splash360_station_id is not null;
comment on column public.restaurants.splash360_station_id is
  'Lot 23 : identifiant client de la station Splash360 (webhooks) ; unique.';

-- 2. États reçus de la caisse, par article publié (« prd… », « ing…-typ… » ou SKU) : disponibilité
-- (§8.1) et prix de livraison propre (§8.2). Appliqués par-dessus la carte de l'API menu, à
-- l'affichage comme au calcul du prix. Serveur uniquement (RLS active, aucune politique).
create table public.menu_stock_overrides (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id text not null check (item_id ~ '^[A-Za-z0-9_.-]{1,100}$'),
  -- null : pas d'état reçu (la carte fait foi).
  available boolean,
  -- Prix de livraison TTC en centimes ; null : prix de livraison du catalogue.
  delivery_price_cents integer check (delivery_price_cents is null
    or delivery_price_cents between 0 and 1000000),
  updated_at timestamptz not null default now(),
  -- webhook-id de l'appel qui a posé le dernier état (diagnostic).
  source_webhook_id text not null check (length(source_webhook_id) between 1 and 200),
  primary key (restaurant_id, item_id)
);
create index menu_stock_overrides_tenant_id_idx on public.menu_stock_overrides (tenant_id);
alter table public.menu_stock_overrides enable row level security;
comment on table public.menu_stock_overrides is
  'Lot 23 : disponibilité et prix de livraison reçus de la caisse Splash360 ; serveur uniquement.';

create trigger menu_stock_overrides_same_tenant before insert or update
on public.menu_stock_overrides
for each row execute function public.check_same_tenant();

-- 3. Appels reçus : dédoublonnage sur webhook-id (au moins 48 h, purgés à 7 jours) et journal
-- « Webhooks reçus » du super-administrateur. Une station inconnue n'a pas encore d'enseigne :
-- donnée de la plateforme, rangée dans le schéma privé du lot 19 (exception assumée à la règle
-- « tenant_id non nul », comme `call_slots`, ADR 0024 et 0029). Aucune donnée personnelle :
-- événement, station, résultat, nombre d'articles, référence de ticket.
create schema if not exists splash360_private;
revoke all on schema splash360_private from public;
revoke all on schema splash360_private from anon, authenticated;

create table splash360_private.webhook_receipts (
  webhook_id text primary key check (length(webhook_id) between 1 and 200),
  event text not null check (event in ('stock', 'prices', 'catalog', 'orders')),
  station_id text not null check (length(station_id) between 1 and 200),
  -- Enseigne et restaurant de la station, si elle est connue.
  tenant_id uuid references public.tenants (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  outcome text not null default 'received' check (outcome in (
    'received', 'applied', 'ignored', 'test', 'unknown_station', 'unknown_order', 'failed'
  )),
  summary jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  check ((tenant_id is null) = (restaurant_id is null))
);
create index webhook_receipts_received_idx on splash360_private.webhook_receipts (received_at desc);
create index webhook_receipts_tenant_id_idx on splash360_private.webhook_receipts (tenant_id);
create index webhook_receipts_restaurant_id_idx
  on splash360_private.webhook_receipts (restaurant_id);
alter table splash360_private.webhook_receipts enable row level security;
revoke all on table splash360_private.webhook_receipts from public;
revoke all on table splash360_private.webhook_receipts from anon, authenticated;
comment on table splash360_private.webhook_receipts is
  'Lot 23 : webhooks Splash360 reçus (dédoublonnage et journal, sans donnée personnelle) ; serveur uniquement.';

create trigger webhook_receipts_same_tenant before insert or update
on splash360_private.webhook_receipts
for each row execute function public.check_same_tenant();
