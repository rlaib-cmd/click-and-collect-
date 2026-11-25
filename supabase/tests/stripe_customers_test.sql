-- Cartes enregistrées (lot 18) : RLS active, table invisible pour anon et authenticated,
-- identifiant Stripe contrôlé et unique.
begin;
select plan(5);
select ok((select relrowsecurity from pg_class where oid = 'public.stripe_customers'::regclass),
  'RLS active sur stripe_customers');
insert into public.tenants (id, name, subdomain, splash360_id) values
  ('ffffffff-0000-4000-8000-000000000018', 'F18', 'test-f18', 'T-F18');
insert into public.stripe_customers (tenant_id, member_id, stripe_customer_id)
  values ('ffffffff-0000-4000-8000-000000000018', 'membre-1', 'cus_Test18');
select throws_ok($$ insert into public.stripe_customers (tenant_id, member_id, stripe_customer_id)
  values ('ffffffff-0000-4000-8000-000000000018', 'membre-2', 'pas-un-client') $$, '23514',
  null, 'identifiant Stripe contrôlé');
select throws_ok($$ insert into public.stripe_customers (tenant_id, member_id, stripe_customer_id)
  values ('ffffffff-0000-4000-8000-000000000018', 'membre-3', 'cus_Test18') $$, '23505',
  null, 'un client Stripe ne sert qu''à un membre');
set local role anon;
select is_empty($$ select * from public.stripe_customers $$, 'anon ne lit aucun client Stripe');
reset role;
set local role authenticated;
select is_empty($$ select * from public.stripe_customers $$, 'authenticated ne lit aucun client Stripe');
reset role;
select * from finish();
