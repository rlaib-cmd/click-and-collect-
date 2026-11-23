-- Rôles du back-office (lot 13, ADR 0017) : gérant accepté, rôles inconnus refusés,
-- équipier rattaché à un restaurant, super-administrateur hors enseigne.
begin;
select plan(6);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'D', 'test-d', 'T-D');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('dddddddd-0000-4000-8000-0000000000aa', 'dddddddd-0000-4000-8000-000000000001', 'Resto D', 'R-D', '1 rue', '75001', 'Paris');

select lives_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('dddddddd-0000-4000-8000-000000000001', 'gerant@d.test', 'manager')
$$, 'un gérant sans restaurant est accepté');

select lives_ok($$
  insert into public.staff_users (tenant_id, restaurant_id, email, role)
  values ('dddddddd-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-0000000000aa', 'gerant2@d.test', 'manager')
$$, 'un gérant peut avoir un restaurant principal');

select throws_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('dddddddd-0000-4000-8000-000000000001', 'boss@d.test', 'owner')
$$, '23514', null, 'rôle inconnu refusé');

select throws_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('dddddddd-0000-4000-8000-000000000001', 'equipier@d.test', 'staff')
$$, '23514', null, 'équipier sans restaurant refusé');

select throws_ok($$
  insert into public.staff_users (tenant_id, email, role)
  values ('dddddddd-0000-4000-8000-000000000001', 'sa@d.test', 'super_admin')
$$, '23514', null, 'super-administrateur rattaché à une enseigne refusé');

set local role authenticated;
select is_empty($$ select id from public.staff_users $$, 'un utilisateur connecté ne lit aucun compte');
reset role;

select * from finish();
rollback;
