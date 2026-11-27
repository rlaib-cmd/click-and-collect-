-- Prénom saisi dans l'application, gardé localement : YouFID refuse la réponse de profil (route 12)
-- quand sa question n'est pas celle en attente (erreur d'intégrité côté YouFID, 27/11).
-- Même règles d'accès que le reste de la table (RLS active, serveur uniquement).
alter table public.loyalty_members_youfid
  add column first_name text check (first_name is null or length(first_name) between 1 and 100);

comment on column public.loyalty_members_youfid.first_name is
  'Prénom saisi dans l''application ; affiché avant celui de YouFID.';
