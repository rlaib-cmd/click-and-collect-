-- Paliers de cadeaux au choix (lot 11, ADR 0014) : la commande garde le produit offert choisi.
begin;
select plan(3);

select has_column('public', 'orders', 'loyalty_reward_product_id', 'produit offert retenu');
select col_is_null('public', 'orders', 'loyalty_reward_product_id', 'facultatif sans cadeau');
-- Un produit offert sans cadeau est refusé (contrainte orders_reward_product_needs_reward).
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'orders_reward_product_needs_reward' and conrelid = 'public.orders'::regclass
  ),
  'un produit offert exige un cadeau'
);

select * from finish();
rollback;
