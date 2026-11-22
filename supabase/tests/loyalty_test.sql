-- Lot 8 : fidélité (données de test) et récompense sur la commande.
begin;
select plan(9);

insert into public.tenants (id, name, subdomain, splash360_id) values
  ('10000000-0000-4000-8000-000000000001', 'Fidèle A', 'fidele-a', 'S360-FA'),
  ('10000000-0000-4000-8000-000000000002', 'Fidèle B', 'fidele-b', 'S360-FB');
insert into public.loyalty_demo_members (id, tenant_id, email, name, card_code) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a@example.fr', 'A', 'CARD-A');

-- 1 et 2. Ni anon ni authenticated ne lisent les membres et leurs mouvements.
set local role anon;
select is_empty(
  $$ select 1 from public.loyalty_demo_members union all select 1 from public.loyalty_demo_movements $$,
  'anon ne lit aucun membre ni mouvement'
);
reset role;
set local role authenticated;
select is_empty(
  $$ select 1 from public.loyalty_demo_members union all select 1 from public.loyalty_demo_movements $$,
  'authenticated ne lit aucun membre ni mouvement'
);
reset role;

-- 3. Un mouvement ne peut pas viser le membre d'une autre enseigne.
select throws_ok(
  $$ insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label)
     values ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'welcome', 100, 'Bienvenue') $$,
  '23514'
);

-- 4. Un gain n'est crédité qu'une fois par commande.
insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label, order_id)
values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'earn', 181, 'Commande',
        '30000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label, order_id)
     values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'earn', 181, 'Commande',
             '30000000-0000-4000-8000-000000000001') $$,
  '23505'
);

-- 5 et 6 (lot 9). Une correction manuelle est admise, sans commande ; un type inconnu est refusé.
select lives_ok(
  $$ insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label)
     values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'adjust', -50, 'Correction') $$,
  'correction manuelle acceptée'
);
select throws_ok(
  $$ insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label, order_id)
     values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'adjust', 10, 'X',
             '30000000-0000-4000-8000-000000000002') $$,
  '23514'
);

-- 7. Supprimer un membre efface son historique.
delete from public.loyalty_demo_members where id = '20000000-0000-4000-8000-000000000001';
select is_empty(
  $$ select 1 from public.loyalty_demo_movements where member_id = '20000000-0000-4000-8000-000000000001' $$,
  'historique effacé avec le membre'
);

-- 8 et 9. Couleur du club : un code hexadécimal ou null (couleur de l'enseigne).
insert into public.tenant_theme (tenant_id) values ('10000000-0000-4000-8000-000000000001')
on conflict (tenant_id) do nothing;
select lives_ok(
  $$ update public.tenant_theme set loyalty_color = '#F2B705' where tenant_id = '10000000-0000-4000-8000-000000000001' $$,
  'couleur du club acceptée'
);
select throws_ok(
  $$ update public.tenant_theme set loyalty_color = 'gold' where tenant_id = '10000000-0000-4000-8000-000000000001' $$,
  '23514'
);

select * from finish();
rollback;
