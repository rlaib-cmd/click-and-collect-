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

-- Comptes du back-office de démonstration (rattachés au premier login par e-mail).
insert into public.staff_users (tenant_id, restaurant_id, email, name, role) values
  (null, null, 'admin@splash360.test', 'Super-admin Splash360', 'super_admin'),
  ('00000000-0000-4000-8000-000000000001', null, 'gerant@bella.test', 'Gérant Bella', 'tenant_admin');
insert into public.staff_users (tenant_id, restaurant_id, email, name, role)
select tenant_id, id, 'equipe@bella.test', 'Équipe Bella Bastille', 'staff' from public.restaurants where splash360_id = 'S360-R-BELLA-1';

update public.tenants set legal_text = 'Conditions générales de vente de démonstration. Vendeur : Pizzeria Bella SAS, 12 rue de la Roquette, 75011 Paris.'
where subdomain = 'bella';

-- Chicken Street (démonstration) : enseigne d'exemple, carte et restaurant fictifs.
insert into public.tenants (id, name, subdomain, splash360_id) values
  ('00000000-0000-4000-8000-000000000004', 'Chicken Street', 'chickenstreet', 'S360-DEMO-CHICKEN')
on conflict (id) do nothing;

insert into public.tenant_theme (tenant_id, logo_url, primary_color, mode, tagline) values
  ('00000000-0000-4000-8000-000000000004', null, '#D62828', 'light', 'Le poulet croustillant, en retrait ou livré')
on conflict (tenant_id) do nothing;

insert into public.restaurants (tenant_id, name, splash360_id, address_line, postal_code, city, latitude, longitude) values
  ('00000000-0000-4000-8000-000000000004', 'Chicken Street (démo)', 'S360-R-CHICKEN-1', '1 place de la Démonstration', '75020', 'Paris', 48.8686, 2.3824)
on conflict (tenant_id, splash360_id) do nothing;

insert into public.restaurant_settings (restaurant_id, tenant_id, pickup_enabled, delivery_enabled, prep_minutes,
  slot_step_minutes, max_orders_per_slot, days_ahead, delivery_minimum_cents, free_delivery_threshold_cents, service_fee_cents)
select id, tenant_id, true, true, 15, 10, 6, 3, 1200, 3000, 0 from public.restaurants where splash360_id = 'S360-R-CHICKEN-1'
on conflict (restaurant_id) do nothing;

-- Ouvert tous les jours, 11:00–23:00.
insert into public.opening_hours (tenant_id, restaurant_id, iso_weekday, opens, closes)
select r.tenant_id, r.id, d, time '11:00', time '23:00' from public.restaurants r, generate_series(1, 7) d
where r.splash360_id = 'S360-R-CHICKEN-1'
  and not exists (select 1 from public.opening_hours h where h.restaurant_id = r.id);

insert into public.delivery_zones (tenant_id, restaurant_id, name, kind, radius_meters, fee_cents)
select r.tenant_id, r.id, z.name, 'radius', z.radius, z.fee
from public.restaurants r, (values ('Moins de 2 km', 2000, 190), ('Moins de 4 km', 4000, 290)) as z(name, radius, fee)
where r.splash360_id = 'S360-R-CHICKEN-1'
  and not exists (select 1 from public.delivery_zones dz where dz.restaurant_id = r.id);

insert into public.staff_users (tenant_id, email, name, role)
select '00000000-0000-4000-8000-000000000004', 'gerant@chickenstreet.test', 'Gérant Chicken Street', 'tenant_admin'
where not exists (select 1 from public.staff_users where email = 'gerant@chickenstreet.test');
insert into public.staff_users (tenant_id, email, name, role)
select '00000000-0000-4000-8000-000000000004', 'proprietaire@chickenstreet.test', 'Propriétaire Chicken Street', 'tenant_admin'
where not exists (select 1 from public.staff_users where email = 'proprietaire@chickenstreet.test');

-- Bills Burger (démonstration) : design aux couleurs de bills-burger.fr (rouge #CF2028, damier,
-- titres en majuscules), carte reprise de son site, restaurant et prix fictifs.
insert into public.tenants (id, name, subdomain, splash360_id) values
  ('00000000-0000-4000-8000-000000000005', 'Bills Burger', 'billsburger', 'S360-DEMO-BILLS')
on conflict (id) do nothing;

insert into public.tenant_theme (tenant_id, logo_url, primary_color, mode, tagline,
  header_style, corner_style, uppercase_titles, pattern) values
  ('00000000-0000-4000-8000-000000000005', 'https://bills-burger.fr/logo.png', '#CF2028', 'light',
   'L''argent ne fait pas le bonheur, le Smash OUI !', 'brand', 'pill', true, 'checker')
on conflict (tenant_id) do nothing;

insert into public.restaurants (tenant_id, name, splash360_id, address_line, postal_code, city, latitude, longitude) values
  ('00000000-0000-4000-8000-000000000005', 'Bills Burger (démo)', 'S360-R-BILLS-1', '1 place de la Démonstration', '75011', 'Paris', 48.8590, 2.3800)
on conflict (tenant_id, splash360_id) do nothing;

insert into public.restaurant_settings (restaurant_id, tenant_id, pickup_enabled, delivery_enabled, prep_minutes,
  slot_step_minutes, max_orders_per_slot, days_ahead, delivery_minimum_cents, free_delivery_threshold_cents, service_fee_cents)
select id, tenant_id, true, true, 15, 10, 6, 3, 1500, 3500, 0 from public.restaurants where splash360_id = 'S360-R-BILLS-1'
on conflict (restaurant_id) do nothing;

-- Ouvert tous les jours, 11:30–23:30.
insert into public.opening_hours (tenant_id, restaurant_id, iso_weekday, opens, closes)
select r.tenant_id, r.id, d, time '11:30', time '23:30' from public.restaurants r, generate_series(1, 7) d
where r.splash360_id = 'S360-R-BILLS-1'
  and not exists (select 1 from public.opening_hours h where h.restaurant_id = r.id);

insert into public.delivery_zones (tenant_id, restaurant_id, name, kind, radius_meters, fee_cents)
select r.tenant_id, r.id, z.name, 'radius', z.radius, z.fee
from public.restaurants r, (values ('Moins de 2 km', 2000, 199), ('Moins de 4 km', 4000, 299)) as z(name, radius, fee)
where r.splash360_id = 'S360-R-BILLS-1'
  and not exists (select 1 from public.delivery_zones dz where dz.restaurant_id = r.id);

-- Comptes de test du back-office (lot 13, ADR 0017) : un compte par rôle.
insert into public.staff_users (tenant_id, email, name, role)
select '00000000-0000-4000-8000-000000000005', 'proprietaire@billsburger.test', 'Camille (propriétaire)', 'tenant_admin'
where not exists (select 1 from public.staff_users where email = 'proprietaire@billsburger.test');
insert into public.staff_users (tenant_id, email, name, role)
select '00000000-0000-4000-8000-000000000005', 'gerant@billsburger.test', 'Yanis (gérant)', 'manager'
where not exists (select 1 from public.staff_users where email = 'gerant@billsburger.test');
insert into public.staff_users (tenant_id, restaurant_id, email, name, role)
select '00000000-0000-4000-8000-000000000005', r.id, 'equipier@billsburger.test', 'Inès (équipière)', 'staff'
from public.restaurants r where r.tenant_id = '00000000-0000-4000-8000-000000000005'
  and not exists (select 1 from public.staff_users where email = 'equipier@billsburger.test')
order by r.created_at limit 1;
