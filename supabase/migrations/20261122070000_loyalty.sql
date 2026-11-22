-- Lot 8 : fidélité. La fidélité appartient à Splash360 ; la commande garde la trace de la récompense
-- utilisée et des points crédités. Les tables loyalty_demo_* simulent l'API fidélité (ADR 0009).

alter table public.orders
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  -- Membre du programme (identifiant Splash360) ; null = commande sans compte fidélité.
  add column loyalty_member_id text,
  add column loyalty_reward_id text,
  add column loyalty_reward_points integer check (loyalty_reward_points is null or loyalty_reward_points > 0),
  -- Renseigné une fois les points crédités et la récompense consommée (paiement confirmé).
  add column loyalty_settled_at timestamptz,
  add constraint orders_reward_needs_member
    check (loyalty_reward_id is null or loyalty_member_id is not null),
  add constraint orders_discount_needs_reward
    check (discount_cents = 0 or loyalty_reward_id is not null);

alter table public.orders drop constraint orders_check;
alter table public.orders add constraint orders_total_matches
  check (total_cents = subtotal_cents + delivery_fee_cents + service_fee_cents - discount_cents);

comment on column public.orders.discount_cents is 'Récompense fidélité déduite du total.';

-- Données de test de la fidélité, en attendant l'API Splash360.
create table public.loyalty_demo_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (email = lower(email)),
  name text not null check (length(trim(name)) > 0),
  phone text,
  points integer not null default 0 check (points >= 0),
  -- Contenu du QR code présenté en caisse.
  card_code text not null unique,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table public.loyalty_demo_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  member_id uuid not null references public.loyalty_demo_members (id) on delete cascade,
  kind text not null check (kind in ('welcome', 'earn', 'redeem')),
  points integer not null check (points <> 0),
  label text not null,
  -- Commande en ligne à l'origine du mouvement : un seul gain et une seule récompense par commande.
  order_id uuid,
  created_at timestamptz not null default now(),
  unique (member_id, kind, order_id)
);
create index loyalty_demo_movements_member_idx on public.loyalty_demo_movements (member_id, created_at desc);

alter table public.loyalty_demo_members enable row level security;
alter table public.loyalty_demo_movements enable row level security;

create function public.check_loyalty_member_tenant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.loyalty_demo_members m where m.id = new.member_id and m.tenant_id = new.tenant_id
  ) then
    raise exception 'tenant_id incohérent avec le membre' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger loyalty_demo_movements_same_tenant before insert or update on public.loyalty_demo_movements
for each row execute function public.check_loyalty_member_tenant();
