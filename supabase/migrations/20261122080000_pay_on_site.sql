-- Paiement sur place (ADR 0010) : option par restaurant, réservée aux membres du club.
-- Une commande « à payer sur place » est confirmée (statut confirmed), part tout de suite
-- vers la caisse, et n'est jamais marquée payée par l'application.

alter table public.restaurant_settings
  add column pay_on_site_enabled boolean not null default false;

alter table public.orders
  add column payment_method text not null default 'online'
    check (payment_method in ('online', 'on_site'));

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'pending_payment', 'paid', 'confirmed', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed',
  'payment_failed', 'cancelled', 'refunded'
));

-- Une commande payée en ligne ne peut pas être « confirmée » et inversement.
alter table public.orders add constraint orders_status_matches_payment check (
  (payment_method = 'on_site' and status not in ('pending_payment', 'paid', 'payment_failed', 'refunded'))
  or (payment_method = 'online' and status <> 'confirmed')
);

-- Paiement sur place réservé aux membres du club (lutte contre les fausses commandes).
alter table public.orders add constraint orders_on_site_needs_member
  check (payment_method = 'online' or loyalty_member_id is not null);

comment on column public.orders.payment_method is 'online : Stripe ; on_site : encaissé au comptoir.';
