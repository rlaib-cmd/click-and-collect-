-- Lot 22 (ADR 0027) : règles, appareils et événements des notifications à proximité.
-- RLS active, aucune lecture pour anon et authenticated, contraintes de format et d'enseigne.
begin;
select plan(15);

select ok((select relrowsecurity from pg_class where oid = 'public.proximity_settings'::regclass),
  'RLS active sur proximity_settings');
select ok((select relrowsecurity from pg_class where oid = 'public.proximity_devices'::regclass),
  'RLS active sur proximity_devices');
select ok((select relrowsecurity from pg_class where oid = 'public.proximity_events'::regclass),
  'RLS active sur proximity_events');

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('ffffffff-0000-4000-8000-000000000022', 'P', 'test-proxi', 'T-P'),
  ('ffffffff-0000-4000-8000-000000000023', 'Q', 'test-proxi-q', 'T-Q');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('ffffffff-1000-4000-8000-000000000022', 'ffffffff-0000-4000-8000-000000000022', 'RP', 'R-P', '1 rue', '75001', 'Paris'),
  ('ffffffff-1000-4000-8000-000000000023', 'ffffffff-0000-4000-8000-000000000023', 'RQ', 'R-Q', '1 rue', '75001', 'Paris');
insert into public.proximity_settings (tenant_id, title, body)
  values ('ffffffff-0000-4000-8000-000000000022', 'T', 'B');
insert into public.proximity_devices (tenant_id, expo_push_token, member_id, platform)
  values ('ffffffff-0000-4000-8000-000000000022', 'ExponentPushToken[abc]', '101', 'ios');
insert into public.proximity_events (tenant_id, member_id, restaurant_id, decision, reason)
  values ('ffffffff-0000-4000-8000-000000000022', '101', 'ffffffff-1000-4000-8000-000000000022', 'sent', 'sent');

select is(
  (select array[enabled::text, radius_meters::text, member_cap_hours::text, target]
   from public.proximity_settings where tenant_id = 'ffffffff-0000-4000-8000-000000000022'),
  array['false', '200', '24', 'all'],
  'défauts : désactivée, 200 m, 1 par 24 h, tous les membres'
);
select throws_ok(
  $$ update public.proximity_settings set radius_meters = 50
     where tenant_id = 'ffffffff-0000-4000-8000-000000000022' $$,
  '23514', null, 'rayon de 100 à 1 000 m'
);
select throws_ok(
  $$ update public.proximity_settings set quiet_start = '22:00'
     where tenant_id = 'ffffffff-0000-4000-8000-000000000022' $$,
  '23514', null, 'heures calmes : début et fin ensemble'
);
select throws_ok(
  $$ update public.proximity_settings set deep_link = 'https://exemple.fr'
     where tenant_id = 'ffffffff-0000-4000-8000-000000000022' $$,
  '23514', null, 'lien de la notification : écran connu seulement'
);
select throws_ok(
  $$ insert into public.proximity_devices (tenant_id, expo_push_token, member_id, platform)
     values ('ffffffff-0000-4000-8000-000000000022', 'pas-un-jeton', '101', 'ios') $$,
  '23514', null, 'jeton push Expo seulement'
);
select throws_ok(
  $$ insert into public.proximity_events (tenant_id, member_id, restaurant_id, decision, reason)
     values ('ffffffff-0000-4000-8000-000000000022', '101', 'ffffffff-1000-4000-8000-000000000023', 'skipped', 'closed') $$,
  '23514', null, 'restaurant d''une autre enseigne refusé'
);
select throws_ok(
  $$ insert into public.proximity_events (tenant_id, member_id, restaurant_id, decision, reason)
     values ('ffffffff-0000-4000-8000-000000000022', '101', 'ffffffff-1000-4000-8000-000000000022', 'sent', 'closed') $$,
  '23514', null, 'un envoi a la raison « sent »'
);
select throws_ok(
  $$ insert into public.proximity_events (tenant_id, member_id, restaurant_id, decision, reason, opened_at)
     values ('ffffffff-0000-4000-8000-000000000022', '101', 'ffffffff-1000-4000-8000-000000000022', 'skipped', 'closed', now()) $$,
  '23514', null, 'seul un envoi peut être ouvert'
);
select hasnt_column('public', 'proximity_events', 'latitude', 'aucune position enregistrée');

set local role anon;
select is_empty($$ select * from public.proximity_devices $$, 'anon ne lit aucun appareil');
select is_empty($$ select * from public.proximity_events $$, 'anon ne lit aucun événement');
reset role;
set local role authenticated;
select is_empty(
  $$ select 1 from public.proximity_settings union all select 1 from public.proximity_devices
     union all select 1 from public.proximity_events $$,
  'authenticated ne lit ni règle, ni appareil, ni événement'
);
reset role;

select * from finish();
rollback;
