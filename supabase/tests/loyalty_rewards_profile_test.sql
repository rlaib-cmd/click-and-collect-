-- Lot 16 (ADR 0021) : catégories par palier et date de naissance facultative du membre.
begin;
select plan(5);

select has_table('public', 'loyalty_reward_settings', 'catégories par palier');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.loyalty_reward_settings'::regclass),
  'RLS activée'
);
select col_is_pk('public', 'loyalty_reward_settings', array['tenant_id', 'reward_id'], 'un réglage par palier et par enseigne');
select has_column('public', 'loyalty_demo_members', 'birth_date', 'date de naissance');
select col_is_null('public', 'loyalty_demo_members', 'birth_date', 'facultative');

select * from finish();
rollback;
