-- Ambassadeur (lot 15, ADR 0019) : réglages cohérents, une participation par ticket, accès serveur.
begin;
select plan(8);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'E', 'test-e', 'T-E'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'F', 'test-f', 'T-F');

select throws_ok($$
  insert into public.ambassador_settings (tenant_id, enabled) values ('eeeeeeee-0000-4000-8000-000000000001', true) $$,
  '23514', null, 'activé sans compte à taguer : refusé');

select throws_ok($$
  insert into public.ambassador_settings (tenant_id, enabled, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000001', true, '@billsburgerfr') $$,
  '23514', null, 'compte enregistré sans « @ »');

select lives_ok($$
  insert into public.ambassador_settings (tenant_id, enabled, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000001', true, 'billsburgerfr') $$, 'réglage valide');

select is((select bonus_points from public.ambassador_settings
  where tenant_id = 'eeeeeeee-0000-4000-8000-000000000001'), 50, 'bonus de 50 points par défaut');

insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'm1', 'BB-1042', 'client.test', 50);

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'm2', 'BB-1042', 'autre', 50) $$,
  '23505', null, 'une seule participation par ticket dans une enseigne');

select lives_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
  values ('eeeeeeee-0000-4000-8000-000000000002', 'm1', 'BB-1042', 'client.test', 50) $$,
  'le même numéro dans une autre enseigne est un autre ticket');

select throws_ok($$
  update public.ambassador_entries set status = 'paid' where ticket_ref = 'BB-1042' $$,
  '23514', null, 'statut inconnu refusé');

set local role anon;
select is((select count(*)::int from public.ambassador_entries), 0, 'anon ne lit aucune participation');
reset role;

select * from finish();
rollback;
