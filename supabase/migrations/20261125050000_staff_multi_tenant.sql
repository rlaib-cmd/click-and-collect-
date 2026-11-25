-- Audit de sécurité du 25/11 (H1) : un même compte Supabase Auth peut appartenir à plusieurs
-- enseignes. L'unicité globale de auth_user_id faisait échouer le rattachement (erreur 500 sur tout
-- le back-office) dès qu'une autre enseigne invitait la même adresse : déni d'accès possible,
-- super-administrateur compris. L'unicité devient « un rattachement par enseigne ».
alter table public.staff_users drop constraint if exists staff_users_auth_user_id_key;

create unique index staff_users_auth_tenant_idx on public.staff_users
  (auth_user_id, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'))
  where auth_user_id is not null;

create index staff_users_auth_user_idx on public.staff_users (auth_user_id)
  where auth_user_id is not null;

-- L'adresse d'un super-administrateur ne peut pas être invitée dans une enseigne (ni l'inverse) :
-- une enseigne ne doit pas pouvoir interférer avec le compte de la plateforme.
create or replace function public.staff_users_no_super_admin_overlap() returns trigger
language plpgsql as $$
begin
  if new.role = 'super_admin' then
    if exists (select 1 from public.staff_users s
               where s.email = new.email and s.role <> 'super_admin' and s.id <> new.id) then
      raise exception 'Adresse déjà utilisée par un compte d''enseigne' using errcode = '23505';
    end if;
  elsif exists (select 1 from public.staff_users s
                where s.email = new.email and s.role = 'super_admin' and s.id <> new.id) then
    raise exception 'Adresse réservée à la plateforme' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger staff_users_no_super_admin_overlap
  before insert or update of email, role on public.staff_users
  for each row execute function public.staff_users_no_super_admin_overlap();
