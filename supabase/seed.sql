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
