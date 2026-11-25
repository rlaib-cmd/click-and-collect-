-- Achat vérifié (lot 20, ADR 0025) : ticket photographié, ventes Splash360 copiées, accès serveur.
begin;
select plan(15);

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
    bonus_points, ticket_check, ticket_id, ticket_date, ticket_time, ticket_total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', '6F1C1C2E-0000-4000-8000-00000000000B',
    'client.test', 50, 'pending', '6f1c1c2e-0000-4000-8000-00000000000b', '2026-11-24', '12:41',
    1230) $$, 'ticket photographié enregistré à vérifier');

select lives_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_id)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', '6F1C1C2E-0000-4000-8000-00000000000C',
    'client.test', 50, 'pending', '6f1c1c2e-0000-4000-8000-00000000000c') $$,
  'ticket de borne scanné (QR) : identifiant seul, à vérifier');

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_id)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', 'BB-2003', 'client.test', 50,
    'maybe', '6f1c1c2e-0000-4000-8000-00000000000d') $$,
  '23514', null, 'état de vérification inconnu refusé');

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_check, ticket_id, ticket_date, ticket_time)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', 'BB-2004', 'client.test', 50,
    'pending', '6f1c1c2e-0000-4000-8000-00000000000e', '2026-11-24', '24:10') $$,
  '23514', null, 'heure hors format refusée');

select throws_ok($$
  insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle,
    bonus_points, ticket_date)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'm1', 'BB-2005', 'client.test', 50,
    '2026-11-24') $$,
  '23514', null, 'ticket non vérifié : ni journée ni total');

select lives_ok($$
  insert into public.ambassador_events (tenant_id, entry_id, type, actor, detail)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000020',
          'ticket_checked', 'système', '{"result":"verified"}') $$, 'événement ticket_checked accepté');

-- Ventes : une par identifiant de vente et par enseigne, statut connu ; export à partir de la page 1.
select lives_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'v-1', '164', '2026-11-24', 'confirmed', 1230) $$,
  'vente copiée');
select throws_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000021', 'v-1', '164', '2026-11-24', 'confirmed', 1230) $$,
  '23505', null, 'une seule copie d''une vente par enseigne');
select throws_ok($$
  insert into public.pos_sales (tenant_id, ticket_id, splash360_restaurant_id, jour_comptable,
    status, total_cents)
  values ('eeeeeeee-0000-4000-8000-000000000022', 'v-2', '164', '2026-11-24', 'standby', 1230) $$,
  '23514', null, 'statut de vente inconnu refusé');
select throws_ok($$
  insert into public.pos_sales_sync (tenant_id, jour, next_page)
  values ('eeeeeeee-0000-4000-8000-000000000021', '2026-11-24', -1) $$,
  '23514', null, 'page négative refusée : l''export commence à la page 0');

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
