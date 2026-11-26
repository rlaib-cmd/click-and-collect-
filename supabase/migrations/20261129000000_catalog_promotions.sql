-- Lot 24 (ADR 0030) : promotions de catalogue de la caisse Splash360 (`reglescatalogue`),
-- appliquées en ligne comme en caisse et figées dans la commande.

-- 1. Totaux : remises des règles (articles + commande) et frais ajoutés par une règle.
alter table public.orders
  add column catalog_discount_cents integer not null default 0 check (catalog_discount_cents >= 0),
  add column catalog_fee_cents integer not null default 0 check (catalog_fee_cents >= 0),
  -- Remise et frais des règles sans produits, figés : [{ ruleId, name, kind, cents, valueLabel,
  -- vatRate }] (renvoyés à la caisse sous le nom exact de la règle).
  add column catalog_adjustments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(catalog_adjustments) = 'array');

alter table public.orders drop constraint orders_total_matches;
alter table public.orders add constraint orders_total_matches
  check (total_cents = subtotal_cents + delivery_fee_cents + service_fee_cents + catalog_fee_cents
    - discount_cents - promo_discount_cents - catalog_discount_cents);

comment on column public.orders.catalog_discount_cents is
  'Lot 24 : remises des promotions de catalogue de la caisse (articles et commande).';
comment on column public.orders.catalog_fee_cents is
  'Lot 24 : frais ajoutés par une promotion de catalogue sans produits (operation +1).';

-- 2. Remises des règles sur une ligne, figées : [{ ruleId, name, units, unitDiscountCents,
-- percentLabel }] ; une entrée par règle, `units` articles remisés chacun de `unitDiscountCents`.
alter table public.order_items
  add column discounts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(discounts) = 'array');

comment on column public.order_items.discounts is
  'Lot 24 : remises des promotions de catalogue sur la ligne (articles remisés, pourcentage envoyé à la caisse).';
