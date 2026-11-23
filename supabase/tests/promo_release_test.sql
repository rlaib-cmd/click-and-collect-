-- Un code promo est rendu quand sa commande est annulée (ADR 0015).
begin;
select plan(3);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('cccccccc-0000-4000-8000-000000000001', 'C', 'test-c', 'T-C');
insert into public.restaurants (id, tenant_id, name, splash360_id, address_line, postal_code, city) values
  ('cccccccc-0000-4000-8000-0000000000aa', 'cccccccc-0000-4000-8000-000000000001', 'Resto C', 'R-C', '1 rue', '75001', 'Paris');
insert into public.customers (id, tenant_id, name, email, phone) values
  ('cccccccc-0000-4000-8000-0000000000cc', 'cccccccc-0000-4000-8000-000000000001', 'Client C', 'c@test.fr', '0600000000');
insert into public.orders (id, tenant_id, restaurant_id, customer_id, number, mode, estimated_at,
    subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents, idempotency_key, status, payment_method, loyalty_member_id)
  values ('cccccccc-0000-4000-8000-0000000000dd', 'cccccccc-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-0000000000aa', 'cccccccc-0000-4000-8000-0000000000cc', 1001, 'pickup', now(),
    1000, 0, 0, 1000, 'kc1', 'confirmed', 'on_site', 'membre-c');
insert into public.promo_codes (id, tenant_id, code, kind, value) values
  ('cccccccc-0000-4000-8000-0000000000ee', 'cccccccc-0000-4000-8000-000000000001', 'RENDU', 'percent', 10);
insert into public.promo_redemptions (tenant_id, promo_code_id, order_id, contact_key) values
  ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-0000000000ee',
   'cccccccc-0000-4000-8000-0000000000dd', 'email:c@test.fr');

update public.orders set status = 'accepted' where id = 'cccccccc-0000-4000-8000-0000000000dd';
select is((select count(*)::int from public.promo_redemptions), 1, 'commande en cours : code consommé');

update public.orders set status = 'cancelled' where id = 'cccccccc-0000-4000-8000-0000000000dd';
select is((select count(*)::int from public.promo_redemptions), 0, 'commande annulée : code rendu');

select lives_ok($$
  insert into public.promo_redemptions (tenant_id, promo_code_id, order_id, contact_key) values
    ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-0000000000ee',
     'cccccccc-0000-4000-8000-0000000000dd', 'email:c@test.fr')
$$, 'le client peut réutiliser son code');

select * from finish();
rollback;
