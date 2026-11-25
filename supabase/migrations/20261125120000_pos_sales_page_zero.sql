-- Lot 20 (ADR 0025) : l'export des ventes Splash360 numérote ses pages à partir de 0.
-- Constaté en recette le 25/11 : page=1 renvoie la deuxième page (28 ventes, pageSize=100 :
-- page 0 → 28 ventes, page 1 → aucune), malgré l'indication « commence à 1 ».
-- Les lectures en cours repartent du début : rien n'a pu être copié depuis la page 1 manquée.
update public.pos_sales_sync set next_page = 0, pass_after_day = false, complete = false;
alter table public.pos_sales_sync
  drop constraint pos_sales_sync_next_page_check,
  alter column next_page set default 0,
  add constraint pos_sales_sync_next_page_check check (next_page between 0 and 10000);
