-- Caisse Splash360 (ADR 0018) : restaurants en démonstration par défaut, phases contrôlées.
begin;
select plan(6);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('dddddddd-0000-4000-8000-000000000001', 'D', 'test-d', 'T-D');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('dddddddd-0000-4000-8000-0000000000aa', 'dddddddd-0000-4000-8000-000000000001', 'Resto D', 'R-D', '1 rue', '75001', 'Paris');
insert into public.customers (id, tenant_id, name, email, phone) values
  ('dddddddd-0000-4000-8000-0000000000cc', 'dddddddd-0000-4000-8000-000000000001', 'Client D', 'd@test.fr', '0600000000');
insert into public.orders (id, tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key)
  values
  ('dddddddd-0000-4000-8000-0000000000d1', 'dddddddd-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-0000000000aa', 'dddddddd-0000-4000-8000-0000000000cc', 1001, 'pickup', now(),
    1000, 0, 0, 1000, 'kd1'),
  ('dddddddd-0000-4000-8000-0000000000d2', 'dddddddd-0000-4000-8000-000000000001',
    'dddddddd-0000-4000-8000-0000000000aa', 'dddddddd-0000-4000-8000-0000000000cc', 1002, 'pickup', now(),
    1000, 0, 0, 1000, 'kd2');

select is(
  (select splash360_live from public.restaurants where id = 'dddddddd-0000-4000-8000-0000000000aa'),
  false, 'un restaurant est en démonstration par défaut');

select lives_ok($$
  update public.orders set pos_ticket_id = 'T-1', pos_phase = 'waiting', pos_opened_at = now()
  where id = 'dddddddd-0000-4000-8000-0000000000d1' $$, 'ticket déposé, en attente');

select throws_ok($$
  update public.orders set pos_phase = 'payee' where id = 'dddddddd-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'phase inconnue refusée');

select throws_ok($$
  update public.orders set pos_phase = 'ready' where id = 'dddddddd-0000-4000-8000-0000000000d2' $$,
  '23514', null, 'pas de phase sans ticket');

select throws_ok($$
  update public.orders set pos_ticket_id = 'T-1' where id = 'dddddddd-0000-4000-8000-0000000000d2' $$,
  '23505', null, 'un ticket ne sert qu''une commande du restaurant');

select col_not_null('public', 'restaurants', 'splash360_live', 'interrupteur toujours renseigné');

select * from finish();
rollback;
