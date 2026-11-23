-- Lot 14 (ADR 0018) : branchement réel de la caisse Splash360.
--
-- Parcours imposé par Splash360 : la commande est déposée en attente (ticket), la caisse doit
-- répondre « ready » AVANT que le client paie, puis « confirmed » après l'envoi du paiement.
-- L'avancement de cette poignée de main est suivi sur la commande elle-même.

-- Restaurant branché sur la vraie API Splash360 (carte et caisse). Faux par défaut :
-- carte et caisse de démonstration, tant que l'équipe Splash360 n'a pas validé le branchement.
alter table public.restaurants
  add column splash360_live boolean not null default false;

comment on column public.restaurants.splash360_live is
  'Vrai : carte et caisse réelles Splash360 (identifiants serveur requis). Faux : démonstration.';

alter table public.orders
  add column pos_ticket_id text,
  add column pos_phase text check (pos_phase in ('waiting', 'ready', 'payment_sent', 'confirmed', 'failed')),
  add column pos_opened_at timestamptz,
  add column pos_ready_at timestamptz,
  add column pos_payment_sent_at timestamptz,
  add column pos_confirmed_at timestamptz,
  add column pos_checked_at timestamptz,
  add column pos_last_status text,
  add column pos_error text;

-- Un ticket ne désigne qu'une commande dans un restaurant.
create unique index orders_pos_ticket_idx on public.orders (restaurant_id, pos_ticket_id)
  where pos_ticket_id is not null;

-- Une phase n'existe qu'avec son ticket.
alter table public.orders add constraint orders_pos_phase_needs_ticket
  check (pos_phase is null or pos_ticket_id is not null);

comment on column public.orders.pos_phase is
  'Caisse Splash360 : waiting (déposée), ready (prête, paiement possible), payment_sent, confirmed (intégrée), failed.';
