-- Achat vérifié (lot 20, ADR 0025) : ticket photographié, ventes Splash360 copiées, accès serveur.
begin;
select plan(13);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('eeeeeeee-0000-4000-8000-000000000021', 'G', 'test-g20', 'T-G20'),
  ('eeeeeeee-0000-4000-8000-000000000022', 'H', 'test-h20', 'T-H20');

insert into public.ambassador_entries (id, tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
  values ('aaaaaaaa-0000-4000-8000-000000000020', 'eeeeeeee-0000-4000-8000-000000000021', 'm1',
          'BB-2002', 'client.test', 50);

select is((select ticket_check from public.ambassador_entries
  where id = 'aaaaaaaa-0000-4000-8000-000000000020'), 'unverified',
  'ticket scanné ou saisi : non vérifié par défaut');

select throws_ok($$
  update public.ambassador_entries set ticket_check = 'pending'
  where id = 'aaaaaaaa-0000-4000-8000-000000000020' $$,
  '23514', null, 'ticket à vérifier sans données lues : refusé');

select lives_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_date, ticket_number, ticket_total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', '20261124-6-1230', 'client.test', 50,
    'pending', '2026-11-24', '6', 1230) $$, 'ticket photographié enregistré à vérifier');

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_date, ticket_number, ticket_total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', '20261124-7-1230', 'client.test', 50,
    'maybe', '2026-11-24', '7', 1230) $$,
  '23514', null, 'état de vérification inconnu refusé');

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_date, ticket_number, ticket_total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', '20261124-8-1230', 'client.test', 50,
    'pending', '2026-11-24', 'n° 8 ; drop', 1230) $$,
  '23514', null, 'numéro de commande hors format refusé');

select lives_ok($$
  insert into public.ambassador_events (tenant_id, entry_id, type, actor, detail)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000020',
          'ticket_checked', 'système', '{"result":"verified"}') $$, 'événement ticket_checked accepté');

-- Ventes : une par identifiant de vente et par enseigne, statut connu.
select lives_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    numero, status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'v-1', '164', '2026-11-24', '6', 'confirmed', 1230) $$,
  'vente copiée');
select throws_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    numero, status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'v-1', '164', '2026-11-24', '6', 'confirmed', 1230) $$,
  '23505', null, 'une seule copie d''une vente par enseigne');
select throws_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    numero, status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000022', 'v-2', '164', '2026-11-24', '6', 'standby', 1230) $$,
  '23514', null, 'statut de vente inconnu refusé');
select throws_ok($$
  insert into public.pos_sales_sync (tenant_id, jour, next_page)
  values ('eeeeeeee-0000-4000-8000-000000000021', '2026-11-24', -1) $$,
  '23514', null, 'page négative refusée');

set local role anon;
select is((select count(*)::int from public.pos_sales), 0, 'anon ne lit aucune vente');
reset role;
set local role authenticated;
select is((select count(*)::int from public.pos_sales), 0, 'authenticated ne lit aucune vente');
select is((select count(*)::int from public.pos_sales_sync), 0,
  'authenticated ne lit aucun avancement de lecture');
reset role;

select * from finish();
rollback;
