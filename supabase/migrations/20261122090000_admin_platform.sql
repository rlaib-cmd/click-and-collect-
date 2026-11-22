-- Lot 9 : administration de la plateforme (ADR 0011).
-- Correction manuelle des points depuis le back-office : nouveau type de mouvement « adjust ».
-- Une correction n'est liée à aucune commande (order_id null) : l'unicité par commande ne la limite pas.

alter table public.loyalty_demo_movements drop constraint loyalty_demo_movements_kind_check;
alter table public.loyalty_demo_movements add constraint loyalty_demo_movements_kind_check
  check (kind in ('welcome', 'earn', 'redeem', 'adjust'));
alter table public.loyalty_demo_movements add constraint loyalty_demo_movements_adjust_without_order
  check (kind <> 'adjust' or order_id is null);
