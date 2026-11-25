-- Version de session des membres (audit M4) : RLS active, invisible pour anon et authenticated.
begin;
select plan(3);
select ok((select relrowsecurity from pg_class where oid = 'public.loyalty_member_sessions'::regclass),
  'RLS active sur loyalty_member_sessions');
insert into public.tenants (id, name, subdomain, splash360_id) values
  ('ffffffff-0000-4000-8000-000000000001', 'F', 'test-f', 'T-F');
insert into public.loyalty_member_sessions (tenant_id, member_id, version)
  values ('ffffffff-0000-4000-8000-000000000001', 'membre-1', 3);
set local role anon;
select is_empty($$ select * from public.loyalty_member_sessions $$, 'anon ne lit aucune session');
reset role;
set local role authenticated;
select is_empty($$ select * from public.loyalty_member_sessions $$, 'authenticated ne lit aucune session');
reset role;
select * from finish();
