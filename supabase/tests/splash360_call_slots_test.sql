-- Lot 19 (ADR 0024) : horodatage des exports de ventes Splash360, réservé au serveur.
begin;
select plan(5);
select ok((select relrowsecurity from pg_class
  where oid = 'splash360_private.call_slots'::regclass), 'RLS active sur call_slots');
select ok(not has_schema_privilege('anon', 'splash360_private', 'usage'),
  'anon n''accède pas au schéma privé');
select ok(not has_schema_privilege('authenticated', 'splash360_private', 'usage'),
  'authenticated n''accède pas au schéma privé');
select throws_ok($$ insert into splash360_private.call_slots (client_key, last_sales_call_at)
  values ('identifiant_en_clair', now()) $$, '23514', null,
  'seule une empreinte SHA-256 est acceptée');
select lives_ok($$ insert into splash360_private.call_slots (client_key, last_sales_call_at)
  values (repeat('a', 64), now()) $$, 'empreinte acceptée');
select * from finish();
