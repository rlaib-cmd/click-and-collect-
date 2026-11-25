-- Ambassadeur complet (lot 17, ADR 0022) : délais, étapes, profil Instagram, historique, accès serveur.
begin;
select plan(14);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('eeeeeeee-0000-4000-8000-000000000011', 'E', 'test-e17', 'T-E17'),
  ('eeeeeeee-0000-4000-8000-000000000012', 'F', 'test-f17', 'T-F17');

insert into public.ambassador_settings (tenant_id, enabled, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000011', true, 'enseigne.e');

select is((select array[check_after_hours, credit_after_hours] from public.ambassador_settings
  where tenant_id = 'eeeeeeee-0000-4000-8000-000000000011'), array[20, 24],
  'contrôle à 20 h et crédit à 24 h par défaut');

select throws_ok($$
  update public.ambassador_settings set check_after_hours = 30, credit_after_hours = 24
  where tenant_id = 'eeeeeeee-0000-4000-8000-000000000011' $$,
  '23514', null, 'le contrôle ne peut pas venir après le crédit');

insert into public.ambassador_entries (id, tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
  values ('aaaaaaaa-0000-4000-8000-000000000017', 'eeeeeeee-0000-4000-8000-000000000011', 'm1',
          'BB-2001', 'client.test', 50);

select is((select needs_review from public.ambassador_entries
  where id = 'aaaaaaaa-0000-4000-8000-000000000017'), false, 'pas « à vérifier » par défaut');

select throws_ok($$
  update public.ambassador_entries set mention_received_at = now()
  where id = 'aaaaaaaa-0000-4000-8000-000000000017' $$,
  '23514', null, 'mention sans échéances de contrôle et de crédit : refusée');

select lives_ok($$
  update public.ambassador_entries set mention_received_at = now(), mention_by = 'equipe@test',
    check_due_at = now() + interval '20 hours', credit_due_at = now() + interval '24 hours'
  where id = 'aaaaaaaa-0000-4000-8000-000000000017' $$, 'mention reçue avec ses échéances');

select throws_ok($$
  update public.ambassador_entries set checked_at = now()
  where id = 'aaaaaaaa-0000-4000-8000-000000000017' $$,
  '23514', null, 'contrôle sans résultat : refusé');

select throws_ok($$
  update public.ambassador_entries set photo_verdict = 'maybe'
  where id = 'aaaaaaaa-0000-4000-8000-000000000017' $$,
  '23514', null, 'verdict de photo inconnu refusé');

-- Profil Instagram : un par membre et par enseigne, format contrôlé.
select lives_ok($$
  insert into public.ambassador_profiles (tenant_id, member_id, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000011', 'm1', 'client.test') $$, 'compte Instagram mémorisé');
select throws_ok($$
  insert into public.ambassador_profiles (tenant_id, member_id, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000011', 'm1', 'autre') $$,
  '23505', null, 'un seul compte mémorisé par membre');
select throws_ok($$
  insert into public.ambassador_profiles (tenant_id, member_id, instagram_handle)
  values ('eeeeeeee-0000-4000-8000-000000000012', 'm1', '@avec.arobase') $$,
  '23514', null, 'compte mémorisé sans « @ »');

-- Historique : même enseigne que la participation, type connu.
select lives_ok($$
  insert into public.ambassador_events (tenant_id, entry_id, type, actor, detail)
  values ('eeeeeeee-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000017',
          'mention_received', 'equipe@test', '{"creditDueAt":"x"}') $$, 'événement journalisé');
select throws_ok($$
  insert into public.ambassador_events (tenant_id, entry_id, type, actor)
  values ('eeeeeeee-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000017',
          'created', 'client') $$,
  '23514', null, 'événement rattaché à une participation d''une autre enseigne : refusé');

set local role anon;
select is((select count(*)::int from public.ambassador_profiles), 0, 'anon ne lit aucun profil');
reset role;
set local role authenticated;
select is((select count(*)::int from public.ambassador_events), 0, 'authenticated ne lit aucun événement');
reset role;

select * from finish();
rollback;
