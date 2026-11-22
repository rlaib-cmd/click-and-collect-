-- Lot 5 : envoi des commandes payées à la caisse Splash360 et notifications.

-- File d'envoi transactionnelle : une ligne est créée dans la même transaction que le passage à « payée ».
create table public.pos_dispatches (
  order_id uuid primary key references public.orders (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pos_dispatches_due_idx on public.pos_dispatches (next_attempt_at) where status = 'pending';

-- Jetons de notification push (Expo) rattachés à une commande, fournis par l'application.
create table public.order_push_tokens (
  order_id uuid not null references public.orders (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  expo_push_token text not null check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  created_at timestamptz not null default now(),
  primary key (order_id, expo_push_token)
);

alter table public.orders add column pos_reference text;
create unique index orders_pos_reference_idx on public.orders (pos_reference) where pos_reference is not null;

alter table public.pos_dispatches enable row level security;
alter table public.order_push_tokens enable row level security;

create trigger pos_dispatches_set_updated_at before update on public.pos_dispatches
for each row execute function public.set_updated_at();

create or replace function public.check_same_tenant() returns trigger
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
  elsif tg_table_name in ('order_items', 'order_events', 'pos_dispatches', 'order_push_tokens') then
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

create trigger pos_dispatches_same_tenant before insert or update on public.pos_dispatches
for each row execute function public.check_same_tenant();
create trigger order_push_tokens_same_tenant before insert or update on public.order_push_tokens
for each row execute function public.check_same_tenant();
