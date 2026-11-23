-- Lot 10 : codes de connexion du client et téléphone des membres.
begin;
select plan(8);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('11000000-0000-4000-8000-000000000001', 'Code A', 'code-a', 'S360-CA');
insert into public.customer_otp_challenges (tenant_id, channel, identifier, code_hash, expires_at) values
  ('11000000-0000-4000-8000-000000000001', 'sms', '+33600000001', repeat('a', 64), now() + interval '10 minutes');

-- 1 et 2. Ni anon ni authenticated ne lisent les codes.
set local role anon;
select is_empty($$ select 1 from public.customer_otp_challenges $$, 'anon ne lit aucun code');
reset role;
set local role authenticated;
select is_empty($$ select 1 from public.customer_otp_challenges $$, 'authenticated ne lit aucun code');
reset role;

-- 3 et 4. L'identifiant suit le canal : téléphone E.164 pour un SMS, e-mail en minuscules.
select throws_ok(
  $$ insert into public.customer_otp_challenges (tenant_id, channel, identifier, code_hash, expires_at)
     values ('11000000-0000-4000-8000-000000000001', 'sms', '0600000001', repeat('a', 64), now()) $$,
  '23514'
);
select throws_ok(
  $$ insert into public.customer_otp_challenges (tenant_id, channel, identifier, code_hash, expires_at)
     values ('11000000-0000-4000-8000-000000000001', 'email', 'Jo@Exemple.fr', repeat('a', 64), now()) $$,
  '23514'
);

-- 5. Un membre peut n'avoir qu'un téléphone.
select lives_ok(
  $$ insert into public.loyalty_demo_members (tenant_id, name, phone, card_code)
     values ('11000000-0000-4000-8000-000000000001', 'Jo', '+33600000001', 'CARD-OTP-1') $$,
  'membre avec téléphone seul'
);
-- 6. Un numéro par compte dans une enseigne.
select throws_ok(
  $$ insert into public.loyalty_demo_members (tenant_id, name, phone, card_code)
     values ('11000000-0000-4000-8000-000000000001', 'Jo bis', '+33600000001', 'CARD-OTP-2') $$,
  '23505'
);
-- 7. Téléphone au format international.
select throws_ok(
  $$ insert into public.loyalty_demo_members (tenant_id, name, phone, card_code)
     values ('11000000-0000-4000-8000-000000000001', 'Jo ter', '06 00 00 00 02', 'CARD-OTP-3') $$,
  '23514'
);
-- 8. Ni téléphone ni e-mail : refusé.
select throws_ok(
  $$ insert into public.loyalty_demo_members (tenant_id, name, card_code)
     values ('11000000-0000-4000-8000-000000000001', 'Personne', 'CARD-OTP-4') $$,
  '23514'
);

select * from finish();
rollback;
