-- Lot 3 : réglages de commande, horaires, zones, clients et commandes.
-- Montants en centimes (integer). Toutes les tables portent tenant_id.

create table public.restaurant_settings (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  prep_minutes integer not null default 20 check (prep_minutes between 0 and 240),
  delivery_minutes integer not null default 20 check (delivery_minutes between 0 and 240),
  slot_step_minutes integer not null default 15 check (slot_step_minutes in (10, 15, 30)),
  max_orders_per_slot integer check (max_orders_per_slot is null or max_orders_per_slot > 0),
  days_ahead integer not null default 7 check (days_ahead between 0 and 30),
  delivery_minimum_cents integer not null default 0 check (delivery_minimum_cents >= 0),
  free_delivery_threshold_cents integer check (free_delivery_threshold_cents is null or free_delivery_threshold_cents >= 0),
  service_fee_cents integer not null default 0 check (service_fee_cents >= 0),
  timezone text not null default 'Europe/Paris',
  updated_at timestamptz not null default now()
);

create table public.opening_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (closes > opens)
);
create index opening_hours_restaurant_idx on public.opening_hours (restaurant_id);

create table public.closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day date not null,
  reason text,
  unique (restaurant_id, day)
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('radius', 'postal_codes')),
  radius_meters integer check (radius_meters is null or radius_meters > 0),
  postal_codes text[] not null default '{}',
  fee_cents integer not null check (fee_cents >= 0),
  check (
    (kind = 'radius' and radius_meters is not null)
    or (kind = 'postal_codes' and cardinality(postal_codes) > 0)
  )
);
create index delivery_zones_restaurant_idx on public.delivery_zones (restaurant_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text not null,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

-- Numéro de commande lisible, par enseigne.
create table public.tenant_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_order_number integer not null default 1000
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  restaurant_id uuid not null references public.restaurants (id),
  customer_id uuid not null references public.customers (id),
  number integer not null,
  mode text not null check (mode in ('pickup', 'delivery')),
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed',
    'payment_failed', 'cancelled', 'refunded'
  )),
  -- Heure demandée : null = dès que possible.
  requested_slot timestamptz,
  estimated_at timestamptz not null,
  delivery_address jsonb,
  delivery_zone_id uuid references public.delivery_zones (id),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  service_fee_cents integer not null check (service_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  stripe_payment_intent_id text unique,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, idempotency_key),
  check (total_cents = subtotal_cents + delivery_fee_cents + service_fee_cents),
  check ((mode = 'delivery') = (delivery_address is not null))
);
create index orders_restaurant_status_idx on public.orders (restaurant_id, status, created_at desc);
create index orders_slot_idx on public.orders (restaurant_id, requested_slot) where requested_slot is not null;
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  order_id uuid not null references public.orders (id) on delete cascade,
  position smallint not null,
  splash360_product_id text not null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 99),
  total_cents integer not null check (total_cents >= 0),
  note text,
  unique (order_id, position)
);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  splash360_group_id text not null,
  splash360_option_id text not null,
  name text not null,
  price_cents integer not null check (price_cents >= 0)
);
create index order_item_options_item_idx on public.order_item_options (order_item_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  -- Auteur : system, customer, stripe, pos, ou l'identifiant d'un compte du back-office.
  actor text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

alter table public.restaurant_settings enable row level security;
alter table public.opening_hours enable row level security;
alter table public.closures enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.customers enable row level security;
alter table public.tenant_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_events enable row level security;

create trigger restaurant_settings_set_updated_at before update on public.restaurant_settings
for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

-- Cohérence d'enseigne : une ligne enfant porte toujours l'enseigne de son parent.
create function public.check_same_tenant() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_tenant uuid;
begin
  if tg_table_name = 'orders' then
    select tenant_id into parent_tenant from public.restaurants where id = new.restaurant_id;
    if parent_tenant is distinct from new.tenant_id then
      raise exception 'tenant_id incohérent avec le restaurant' using errcode = '23514';
    end if;
    select tenant_id into parent_tenant from public.customers where id = new.customer_id;
  elsif tg_table_name = 'order_items' or tg_table_name = 'order_events' then
    select tenant_id into parent_tenant from public.orders where id = new.order_id;
  elsif tg_table_name = 'order_item_options' then
    select tenant_id into parent_tenant from public.order_items where id = new.order_item_id;
  else
    select tenant_id into parent_tenant from public.restaurants where id = new.restaurant_id;
  end if;
  if parent_tenant is distinct from new.tenant_id then
    raise exception 'tenant_id incohérent avec la ligne parente' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger orders_same_tenant before insert or update on public.orders
for each row execute function public.check_same_tenant();
create trigger order_items_same_tenant before insert or update on public.order_items
for each row execute function public.check_same_tenant();
create trigger order_item_options_same_tenant before insert or update on public.order_item_options
for each row execute function public.check_same_tenant();
create trigger order_events_same_tenant before insert or update on public.order_events
for each row execute function public.check_same_tenant();
create trigger restaurant_settings_same_tenant before insert or update on public.restaurant_settings
for each row execute function public.check_same_tenant();
create trigger opening_hours_same_tenant before insert or update on public.opening_hours
for each row execute function public.check_same_tenant();
create trigger closures_same_tenant before insert or update on public.closures
for each row execute function public.check_same_tenant();
create trigger delivery_zones_same_tenant before insert or update on public.delivery_zones
for each row execute function public.check_same_tenant();
