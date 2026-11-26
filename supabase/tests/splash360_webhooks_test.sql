-- Lot 23 (ADR 0029) : webhooks Splash360. Station du restaurant unique, états de la caisse
-- réservés au serveur (RLS sans politique), appels reçus dans le schéma privé.
begin;
select plan(14);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('ffffffff-0000-4000-8000-000000000123', 'W', 'test-webhooks', 'T-W'),
  ('ffffffff-0000-4000-8000-000000000124', 'X', 'test-webhooks-x', 'T-X');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city,
  splash360_station_id) values
  ('ffffffff-1000-4000-8000-000000000123', 'ffffffff-0000-4000-8000-000000000123', 'RW', 'R-W',
   '1 rue', '75001', 'Paris', '123_4abc5def'),
  ('ffffffff-1000-4000-8000-000000000124', 'ffffffff-0000-4000-8000-000000000124', 'RX', 'R-X',
   '1 rue', '75001', 'Paris', null);

select throws_ok(
  $$ update public.restaurants set splash360_station_id = '123_4abc5def'
     where id = 'ffffffff-1000-4000-8000-000000000124' $$,
  '23505', null, 'une station = un seul restaurant'
);
select throws_ok(
  $$ update public.restaurants set splash360_station_id = '123/../x'
     where id = 'ffffffff-1000-4000-8000-000000000124' $$,
  '23514', null, 'identifiant de station : lettres, chiffres, _ . - seulement'
);

select ok((select relrowsecurity from pg_class where oid = 'public.menu_stock_overrides'::regclass),
  'RLS active sur menu_stock_overrides');
select is((select count(*)::int from pg_policies where tablename = 'menu_stock_overrides'), 0,
  'aucune politique : serveur uniquement');

insert into public.menu_stock_overrides (tenant_id, restaurant_id, item_id, available, source_webhook_id)
  values ('ffffffff-0000-4000-8000-000000000123', 'ffffffff-1000-4000-8000-000000000123',
          'ing22947-typ5626', false, 'msg_1');

select throws_ok(
  $$ insert into public.menu_stock_overrides (tenant_id, restaurant_id, item_id, available, source_webhook_id)
     values ('ffffffff-0000-4000-8000-000000000124', 'ffffffff-1000-4000-8000-000000000123',
             'prd1', false, 'msg_2') $$,
  '23514', null, 'enseigne cohérente avec le restaurant'
);
select throws_ok(
  $$ insert into public.menu_stock_overrides (tenant_id, restaurant_id, item_id, delivery_price_cents, source_webhook_id)
     values ('ffffffff-0000-4000-8000-000000000123', 'ffffffff-1000-4000-8000-000000000123',
             'prd2', -1, 'msg_3') $$,
  '23514', null, 'prix de livraison positif'
);
select throws_ok(
  $$ insert into public.menu_stock_overrides (tenant_id, restaurant_id, item_id, available, source_webhook_id)
     values ('ffffffff-0000-4000-8000-000000000123', 'ffffffff-1000-4000-8000-000000000123',
             'prd 3 <script>', false, 'msg_4') $$,
  '23514', null, 'identifiant d''article au format Splash360'
);

-- Appels reçus : schéma privé, inaccessible hors du serveur.
select ok((select relrowsecurity from pg_class
  where oid = 'splash360_private.webhook_receipts'::regclass), 'RLS active sur webhook_receipts');
select ok(not has_table_privilege('anon', 'splash360_private.webhook_receipts', 'select'),
  'anon ne lit pas les appels reçus');
select ok(not has_table_privilege('authenticated', 'splash360_private.webhook_receipts', 'select'),
  'authenticated ne lit pas les appels reçus');

insert into splash360_private.webhook_receipts (webhook_id, event, station_id, outcome)
  values ('msg_inconnue', 'stock', '999_zzz', 'unknown_station');
select throws_ok(
  $$ insert into splash360_private.webhook_receipts (webhook_id, event, station_id)
     values ('msg_inconnue', 'stock', '999_zzz') $$,
  '23505', null, 'webhook-id unique (dédoublonnage)'
);
select throws_ok(
  $$ insert into splash360_private.webhook_receipts (webhook_id, event, station_id, tenant_id, restaurant_id)
     values ('msg_x', 'stock', '123_4abc5def', 'ffffffff-0000-4000-8000-000000000124',
             'ffffffff-1000-4000-8000-000000000123') $$,
  '23514', null, 'enseigne cohérente avec le restaurant de la station'
);
select throws_ok(
  $$ insert into splash360_private.webhook_receipts (webhook_id, event, station_id)
     values ('msg_y', 'menus', '123_4abc5def') $$,
  '23514', null, 'événement connu seulement'
);

set local role authenticated;
select is_empty($$ select 1 from public.menu_stock_overrides $$,
  'authenticated ne lit aucun état de la caisse');
reset role;

select * from finish();
rollback;
