-- Identité du client final : e-mail facultatif, clé par e-mail sinon téléphone (ADR 0013).
begin;
select plan(5);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'C', 'test-c', 'T-C'),
  ('dddddddd-0000-4000-8000-000000000001', 'D', 'test-d', 'T-D');

-- 1. Un client sans e-mail est accepté.
select lives_ok($$
  insert into public.customers (tenant_id, name, email, phone, contact_key)
  values ('cccccccc-0000-4000-8000-000000000001', 'Sans mail', null, '06 12 34 56 78', 'tel:+33612345678')
$$, 'client sans e-mail');

-- 2. Deux clients ne peuvent pas avoir la même identité dans une enseigne.
select throws_ok($$
  insert into public.customers (tenant_id, name, email, phone, contact_key)
  values ('cccccccc-0000-4000-8000-000000000001', 'Doublon', null, '0612345678', 'tel:+33612345678')
$$, '23505', null, 'même téléphone, même enseigne : refusé');

-- 3. La même identité est permise dans une autre enseigne.
select lives_ok($$
  insert into public.customers (tenant_id, name, email, phone, contact_key)
  values ('dddddddd-0000-4000-8000-000000000001', 'Ailleurs', null, '0612345678', 'tel:+33612345678')
$$, 'même téléphone, autre enseigne');

-- 4. Sans clé fournie, la base la déduit de l'e-mail.
insert into public.customers (tenant_id, name, email, phone)
values ('cccccccc-0000-4000-8000-000000000001', 'Avec mail', 'Paul@Test.fr', '0600000000');
select is(
  (select contact_key from public.customers where name = 'Avec mail'),
  'email:paul@test.fr',
  'clé déduite de l''e-mail'
);

-- 5. Une clé mal formée est refusée.
select throws_ok($$
  insert into public.customers (tenant_id, name, email, phone, contact_key)
  values ('cccccccc-0000-4000-8000-000000000001', 'Mauvais', null, '0600000001', 'n''importe quoi')
$$, '23514', null, 'clé mal formée refusée');

select * from finish();
rollback;
