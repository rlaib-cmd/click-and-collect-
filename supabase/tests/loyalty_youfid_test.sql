-- Lot 21 (ADR 0026) : lien YouFID, registre des opérations et réglages du programme.
-- RLS active, aucune lecture pour anon et authenticated, contraintes d'unicité et de format.
begin;
select plan(13);

select ok((select relrowsecurity from pg_class where oid = 'public.loyalty_members_youfid'::regclass),
  'RLS active sur loyalty_members_youfid');
select ok((select relrowsecurity from pg_class where oid = 'public.loyalty_operations'::regclass),
  'RLS active sur loyalty_operations');
select ok((select relrowsecurity from pg_class where oid = 'public.loyalty_program_settings'::regclass),
  'RLS active sur loyalty_program_settings');

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('ffffffff-0000-4000-8000-000000000021', 'Y', 'test-youfid', 'T-Y');
insert into public.loyalty_members_youfid (tenant_id, usr_id, qr_code, phone)
  values ('ffffffff-0000-4000-8000-000000000021', '101', 'QR101', '+33612345678');
insert into public.loyalty_operations (tenant_id, op_key, kind, member_id, points, label)
  values ('ffffffff-0000-4000-8000-000000000021', 'order:o1:earn', 'earn', '101', 120, 'Commande n° 1');
insert into public.loyalty_program_settings (tenant_id)
  values ('ffffffff-0000-4000-8000-000000000021');

select is(
  (select array[points_per_euro, welcome_points] from public.loyalty_program_settings
   where tenant_id = 'ffffffff-0000-4000-8000-000000000021'),
  array[1, 100],
  'défauts : 1 point par euro, 100 points de bienvenue'
);
select throws_ok(
  $$ insert into public.loyalty_operations (tenant_id, op_key, kind, member_id, points, label)
     values ('ffffffff-0000-4000-8000-000000000021', 'order:o1:earn', 'earn', '101', 120, 'x') $$,
  '23505', null, 'une clé d''opération par enseigne (exactement une fois)'
);
select throws_ok(
  $$ insert into public.loyalty_operations (tenant_id, op_key, kind, member_id, points, label, status)
     values ('ffffffff-0000-4000-8000-000000000021', 'k2', 'earn', '101', 1, 'x', 'inconnu') $$,
  '23514', null, 'statut contrôlé'
);
select throws_ok(
  $$ insert into public.loyalty_members_youfid (tenant_id, usr_id, qr_code)
     values ('ffffffff-0000-4000-8000-000000000021', 'abc', 'QR') $$,
  '23514', null, 'usr_id numérique'
);
select throws_ok(
  $$ insert into public.loyalty_members_youfid (tenant_id, usr_id, qr_code, phone)
     values ('ffffffff-0000-4000-8000-000000000021', '102', 'QR', '0612345678') $$,
  '23514', null, 'téléphone au format E.164'
);

set local role anon;
select is_empty($$ select * from public.loyalty_members_youfid $$, 'anon ne lit aucun lien');
select is_empty($$ select * from public.loyalty_operations $$, 'anon ne lit aucune opération');
reset role;
set local role authenticated;
select is_empty($$ select * from public.loyalty_members_youfid $$, 'authenticated ne lit aucun lien');
select is_empty($$ select * from public.loyalty_operations $$, 'authenticated ne lit aucune opération');
select is_empty($$ select * from public.loyalty_program_settings $$, 'authenticated ne lit aucun réglage');
reset role;

select * from finish();
rollback;
