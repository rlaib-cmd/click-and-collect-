-- Lot 11 : les cadeaux deviennent des paliers avec plusieurs produits au choix (ADR 0014).
-- La commande garde le produit offert choisi par le client.

alter table public.orders
  add column loyalty_reward_product_id text
    check (loyalty_reward_product_id is null or length(loyalty_reward_product_id) between 1 and 100),
  add constraint orders_reward_product_needs_reward
    check (loyalty_reward_product_id is null or loyalty_reward_id is not null);

comment on column public.orders.loyalty_reward_product_id is
  'Produit offert choisi dans le palier de cadeaux (identifiant de la carte Splash360).';
