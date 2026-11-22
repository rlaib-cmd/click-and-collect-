-- Données de démonstration (développement et recette uniquement).
insert into public.tenants (id, name, subdomain, splash360_id) values
  ('00000000-0000-4000-8000-000000000001', 'Pizzeria Bella', 'bella', 'S360-DEMO-BELLA'),
  ('00000000-0000-4000-8000-000000000002', 'Green Bowl', 'greenbowl', 'S360-DEMO-GREEN'),
  ('00000000-0000-4000-8000-000000000003', 'Enseigne suspendue', 'suspendue', 'S360-DEMO-SUSP');

update public.tenants set status = 'suspended' where subdomain = 'suspendue';

insert into public.tenant_theme (tenant_id, logo_url, primary_color, mode, tagline) values
  ('00000000-0000-4000-8000-000000000001', 'https://placehold.co/256x256/C8102E/FFFFFF/png?text=Bella', '#C8102E', 'light', 'La vraie pizza napolitaine'),
  ('00000000-0000-4000-8000-000000000002', 'https://placehold.co/256x256/A3E635/14532D/png?text=Green', '#A3E635', 'dark', 'Frais, local, de saison');

insert into public.restaurants (tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('00000000-0000-4000-8000-000000000001', 'Bella Bastille', 'S360-R-BELLA-1', '12 rue de la Roquette', '75011', 'Paris'),
  ('00000000-0000-4000-8000-000000000002', 'Green Bowl Opéra', 'S360-R-GREEN-1', '3 rue Scribe', '75009', 'Paris');

-- Réglages de commande de démonstration.
insert into public.restaurant_settings (restaurant_id, tenant_id, pickup_enabled, delivery_enabled, prep_minutes,
  slot_step_minutes, max_orders_per_slot, days_ahead, delivery_minimum_cents, free_delivery_threshold_cents, service_fee_cents)
select id, tenant_id, true, true, 20, 15, 4, 7, 1500, 3500, 0 from public.restaurants where splash360_id = 'S360-R-BELLA-1';
insert into public.restaurant_settings (restaurant_id, tenant_id, pickup_enabled, delivery_enabled, prep_minutes,
  slot_step_minutes, max_orders_per_slot, days_ahead, service_fee_cents)
select id, tenant_id, true, false, 15, 10, null, 2, 50 from public.restaurants where splash360_id = 'S360-R-GREEN-1';

-- Bella : 11:30–14:30 et 18:30–22:30, fermé le lundi. Green Bowl : 11:00–15:00 en semaine.
insert into public.opening_hours (tenant_id, restaurant_id, iso_weekday, opens, closes)
select r.tenant_id, r.id, d, time '11:30', time '14:30' from public.restaurants r, generate_series(2, 7) d where r.splash360_id = 'S360-R-BELLA-1'
union all
select r.tenant_id, r.id, d, time '18:30', time '22:30' from public.restaurants r, generate_series(2, 7) d where r.splash360_id = 'S360-R-BELLA-1'
union all
select r.tenant_id, r.id, d, time '11:00', time '15:00' from public.restaurants r, generate_series(1, 5) d where r.splash360_id = 'S360-R-GREEN-1';

update public.restaurants set latitude = 48.8553, longitude = 2.3747 where splash360_id = 'S360-R-BELLA-1';
update public.restaurants set latitude = 48.8719, longitude = 2.3316 where splash360_id = 'S360-R-GREEN-1';

insert into public.delivery_zones (tenant_id, restaurant_id, name, kind, radius_meters, fee_cents)
select tenant_id, id, 'Moins de 2 km', 'radius', 2000, 190 from public.restaurants where splash360_id = 'S360-R-BELLA-1'
union all
select tenant_id, id, 'Moins de 4 km', 'radius', 4000, 390 from public.restaurants where splash360_id = 'S360-R-BELLA-1';
