-- Codes promo (lot 11, ADR 0015) : format, valeurs, unicité par enseigne, cloisonnement.
begin;
select plan(6);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'E', 'test-e', 'T-E'),
  ('ffffffff-0000-4000-8000-000000000001', 'F', 'test-f', 'T-F');

select lives_ok($$
  insert into public.promo_codes (tenant_id, code, kind, value)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'BIENVENUE', 'percent', 10)
$$, 'code valide');

select throws_ok($$
  insert into public.promo_codes (tenant_id, code, kind, value)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'BIENVENUE', 'fixed', 300)
$$, '23505', null, 'même code, même enseigne : refusé');

select lives_ok($$
  insert into public.promo_codes (tenant_id, code, kind, value)
  values ('ffffffff-0000-4000-8000-000000000001', 'BIENVENUE', 'fixed', 300)
$$, 'même code, autre enseigne');

select throws_ok($$
  insert into public.promo_codes (tenant_id, code, kind, value)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'TROP', 'percent', 150)
$$, '23514', null, 'pourcentage au-delà de 100 refusé');

select throws_ok($$
  insert into public.promo_codes (tenant_id, code, kind, value)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'minuscule', 'fixed', 100)
$$, '23514', null, 'code en minuscules refusé');

-- Les tables sont fermées aux rôles du navigateur : tout passe par l'API (ADR 0002).
set local role anon;
select is((select count(*)::int from public.promo_codes), 0, 'anon ne lit aucun code');
reset role;

select * from finish();
rollback;
