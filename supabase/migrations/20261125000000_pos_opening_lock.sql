-- Lot 14 (ADR 0018) : un seul dépôt en caisse par commande.
-- L'application interroge l'état de la caisse chaque seconde : deux requêtes simultanées pouvaient
-- déposer deux fois la commande chez Splash360 (ticket en double en cuisine). Le dépôt est
-- désormais réservé par cette date, posée de façon atomique avant d'appeler Splash360.
alter table public.orders add column pos_opening_at timestamptz;

comment on column public.orders.pos_opening_at is
  'Caisse Splash360 : dépôt en cours depuis cette date (réservation, expire au bout de 30 s).';
