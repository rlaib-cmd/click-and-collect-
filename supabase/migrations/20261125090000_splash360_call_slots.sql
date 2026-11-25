-- Lot 19 (ADR 0024) : coordination des appels Splash360 entre instances du serveur.
-- Splash360 exige des appels séquentiels par identifiant client et au plus un export des ventes
-- par minute et par identifiant client. L'identifiant client est une donnée de la plateforme,
-- pas d'une enseigne : la table vit dans un schéma privé, hors de l'API REST de Supabase, et ne
-- contient qu'une empreinte SHA-256 de l'identifiant client (jamais l'identifiant ni le secret).
-- Exception assumée à la règle « tenant_id sur toute table » (ADR 0024).
create schema if not exists splash360_private;
revoke all on schema splash360_private from public;
revoke all on schema splash360_private from anon, authenticated;

create table splash360_private.call_slots (
  client_key text primary key check (client_key ~ '^[0-9a-f]{64}$'),
  last_sales_call_at timestamptz not null
);

alter table splash360_private.call_slots enable row level security;
revoke all on table splash360_private.call_slots from public;
revoke all on table splash360_private.call_slots from anon, authenticated;

comment on table splash360_private.call_slots is
  'Dernier export des ventes Splash360 par identifiant client haché ; serveur uniquement (ADR 0024).';
