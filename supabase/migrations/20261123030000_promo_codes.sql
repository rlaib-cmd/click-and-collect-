-- Lot 11 : codes promo créés par l'enseigne dans le back-office (ADR 0015).

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  -- Pourcentage (1 à 100) ou montant en centimes.
  value integer not null check (value > 0 and (kind <> 'percent' or value <= 100)),
  min_subtotal_cents integer not null default 0 check (min_subtotal_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

-- Une utilisation par commande ; un même client (identité de commande) n'utilise un code qu'une fois.
create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  promo_code_id uuid not null references public.promo_codes (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  contact_key text not null,
  loyalty_member_id text,
  created_at timestamptz not null default now(),
  unique (promo_code_id, contact_key)
);
create index promo_redemptions_member_idx on public.promo_redemptions (promo_code_id, loyalty_member_id);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;

create function public.check_promo_redemption_tenant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.promo_codes p where p.id = new.promo_code_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'tenant_id incohérent avec le code promo' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger promo_redemptions_same_tenant before insert or update on public.promo_redemptions
for each row execute function public.check_promo_redemption_tenant();

alter table public.orders
  add column promo_code text,
  add column promo_discount_cents integer not null default 0 check (promo_discount_cents >= 0),
  add constraint orders_promo_discount_needs_code
    check (promo_discount_cents = 0 or promo_code is not null);

alter table public.orders drop constraint orders_total_matches;
alter table public.orders add constraint orders_total_matches
  check (total_cents = subtotal_cents + delivery_fee_cents + service_fee_cents - discount_cents - promo_discount_cents);

comment on table public.promo_codes is 'Codes promo d''une enseigne (back-office), appliqués après la récompense fidélité.';
