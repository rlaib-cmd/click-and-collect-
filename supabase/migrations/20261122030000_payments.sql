-- Lot 4 : paiement Stripe Connect (paiements directs sur le compte du restaurant).

-- Commission Splash360 par enseigne, en points de base (100 = 1 %) et/ou montant fixe par commande.
alter table public.tenants
  add column application_fee_bps integer not null default 0 check (application_fee_bps between 0 and 3000),
  add column application_fee_fixed_cents integer not null default 0 check (application_fee_fixed_cents >= 0);

-- État du compte Stripe connecté, tenu à jour par le webhook account.updated.
alter table public.restaurants
  add column stripe_charges_enabled boolean not null default false;

alter table public.orders
  add column application_fee_cents integer not null default 0 check (application_fee_cents >= 0),
  -- Empreinte SHA-256 du jeton remis au client pour suivre sa commande (le jeton n'est jamais stocké).
  add column access_token_hash text,
  add column paid_at timestamptz;

create index orders_pending_idx on public.orders (created_at) where status = 'pending_payment';
