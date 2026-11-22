-- Tests des règles d'accès (pgTAP), lancés par `supabase test db`.
begin;
select plan(5);

-- 1. Toutes les tables du schéma public ont la sécurité par ligne activée.
select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'toutes les tables publiques ont la RLS activée'
);

-- 2. Toutes les tables publiques, sauf tenants, portent une colonne tenant_id.
select is_empty(
  $$ select t.table_name from information_schema.tables t
     where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and t.table_name <> 'tenants'
       and not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.table_name
           and c.column_name = 'tenant_id') $$,
  'toutes les tables publiques (hors tenants) ont une colonne tenant_id'
);

insert into public.tenants (name, subdomain, splash360_id)
values ('Enseigne A', 'enseigne-a', 'S360-A'), ('Enseigne B', 'enseigne-b', 'S360-B');

-- 3. Un visiteur anonyme ne voit aucune enseigne.
set local role anon;
select is_empty($$ select id from public.tenants $$, 'anon ne lit aucune enseigne');
reset role;

-- 4. Un utilisateur connecté sans rôle ne voit aucune enseigne.
set local role authenticated;
select is_empty($$ select id from public.tenants $$, 'authenticated ne lit aucune enseigne sans règle');
reset role;

-- 5. Un sous-domaine invalide est refusé.
select throws_ok(
  $$ insert into public.tenants (name, subdomain, splash360_id) values ('X', 'Pas Valide', 'S360-X') $$,
  '23514'
);

select * from finish();
rollback;
