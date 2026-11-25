-- Audit de sécurité du 25/11 (H1) : un compte Auth peut appartenir à plusieurs enseignes,
-- une fois par enseigne ; l'adresse d'un super-administrateur ne peut pas être invitée.
begin;
select plan(5);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'E1', 'test-e1', 'T-E1'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'E2', 'test-e2', 'T-E2');

select lives_ok($$
  insert into public.staff_users (tenant_id, email, role, auth_user_id) values
    ('eeeeeeee-0000-4000-8000-000000000001', 'multi@e.test', 'tenant_admin', 'auth-multi'),
    ('eeeeeeee-0000-4000-8000-000000000002', 'multi@e.test', 'manager', 'auth-multi')
$$, 'le même compte Auth est rattaché dans deux enseignes');

select throws_ok($$
  insert into public.staff_users (tenant_id, email, role, auth_user_id)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'autre@e.test', 'manager', 'auth-multi')
$$, '23505', null, 'deux rattachements du même compte dans une même enseigne refusés');

insert into public.staff_users (email, role) values ('plateforme@e.test', 'super_admin');

select throws_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('eeeeeeee-0000-4000-8000-000000000001', 'plateforme@e.test', 'manager')
$$, '23505', null, 'inviter l''adresse d''un super-administrateur est refusé');

select throws_ok($$
  insert into public.staff_users (email, role) values ('multi@e.test', 'super_admin')
$$, '23505', null, 'un compte d''enseigne ne devient pas super-administrateur par la même adresse');

select lives_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('eeeeeeee-0000-4000-8000-000000000002', 'nouveau@e.test', 'manager')
$$, 'une invitation ordinaire reste possible');

select * from finish();
