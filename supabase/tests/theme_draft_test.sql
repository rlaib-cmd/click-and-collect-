-- Brouillon du design (lot 12, ADR 0016) : forme, datation, cloisonnement.
begin;
select plan(5);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'D', 'test-d', 'T-D');
insert into public.tenant_theme (tenant_id) values ('dddddddd-0000-4000-8000-000000000001');

select lives_ok($$
  update public.tenant_theme set draft = '{"primaryColor": "#112233"}', draft_updated_at = now()
  where tenant_id = 'dddddddd-0000-4000-8000-000000000001'
$$, 'brouillon enregistré');

select throws_ok($$
  update public.tenant_theme set draft = '["pas", "un", "objet"]'
  where tenant_id = 'dddddddd-0000-4000-8000-000000000001'
$$, '23514', null, 'brouillon qui n''est pas un objet refusé');

select throws_ok($$
  update public.tenant_theme set draft_updated_at = null
  where tenant_id = 'dddddddd-0000-4000-8000-000000000001'
$$, '23514', null, 'brouillon sans date refusé');

select lives_ok($$
  update public.tenant_theme set draft = null, draft_updated_at = null
  where tenant_id = 'dddddddd-0000-4000-8000-000000000001'
$$, 'brouillon effacé');

set local role anon;
select is((select count(*)::int from public.tenant_theme where draft is not null), 0,
  'anon ne lit aucun brouillon');
reset role;

select * from finish();
rollback;
