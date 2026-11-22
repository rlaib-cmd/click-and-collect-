-- Intégrité des commandes (pgTAP).
begin;
select plan(5);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'A', 'test-a', 'T-A'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'B', 'test-b', 'T-B');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-000000000001', 'Resto A', 'R-A', '1 rue', '75001', 'Paris');
insert into public.customers (id, tenant_id, name, email, phone) values
  ('aaaaaaaa-0000-4000-8000-0000000000cc', 'aaaaaaaa-0000-4000-8000-000000000001', 'Client A', 'a@test.fr', '0600000000'),
  ('bbbbbbbb-0000-4000-8000-0000000000cc', 'bbbbbbbb-0000-4000-8000-000000000001', 'Client B', 'b@test.fr', '0600000000');

-- 1. Une commande valide est acceptée.
select lives_ok($$
  insert into public.orders (id, tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key)
  values ('aaaaaaaa-0000-4000-8000-0000000000dd', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-0000000000aa', 'aaaaaaaa-0000-4000-8000-0000000000cc', 1001, 'pickup', now(),
    1000, 0, 50, 1050, 'k1')
$$, 'commande valide');

-- 2. Une commande d'une enseigne ne peut pas pointer le restaurant d'une autre.
select throws_ok($$
  insert into public.orders (tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000aa',
    'bbbbbbbb-0000-4000-8000-0000000000cc', 1001, 'pickup', now(), 1000, 0, 0, 1000, 'k2')
$$, '23514', null, 'restaurant d''une autre enseigne refusé');

-- 3. Ni le client d'une autre enseigne.
select throws_ok($$
  insert into public.orders (tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000aa',
    'bbbbbbbb-0000-4000-8000-0000000000cc', 1002, 'pickup', now(), 1000, 0, 0, 1000, 'k3')
$$, '23514', null, 'client d''une autre enseigne refusé');

-- 4. Le total doit être la somme des montants.
select throws_ok($$
  insert into public.orders (tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000aa',
    'aaaaaaaa-0000-4000-8000-0000000000cc', 1003, 'pickup', now(), 1000, 0, 0, 1, 'k4')
$$, '23514', null, 'total incohérent refusé');

-- 5. Une ligne de commande ne peut pas changer d'enseigne.
select throws_ok($$
  insert into public.order_items (tenant_id, order_id, position, splash360_product_id, name, unit_price_cents, quantity, total_cents)
  values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000dd', 0, 'p', 'P', 100, 1, 100)
$$, '23514', null, 'ligne rattachée à une autre enseigne refusée');

select * from finish();
rollback;
