-- Lot 18 (ADR 0023) : cartes enregistrées. Un client Stripe (Customer) sur la PLATEFORME par membre
-- du club et par enseigne ; ses cartes sont clonées vers le compte Stripe du restaurant au moment
-- de payer (paiements directs). Aucune donnée de carte n'est stockée ici : seul l'identifiant Stripe.
create table public.stripe_customers (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  member_id text not null check (length(member_id) between 1 and 100),
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

alter table public.stripe_customers enable row level security;

comment on table public.stripe_customers is
  'Client Stripe de la plateforme par membre du club ; lu et écrit par le serveur uniquement (pas de politique).';
