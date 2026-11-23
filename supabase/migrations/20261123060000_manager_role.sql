-- Lot 13 (ADR 0017) : rôle « Gérant » (manager) entre le propriétaire de l'enseigne
-- (tenant_admin) et l'équipier (staff). Les droits de chaque rôle sont dans @splash360/core.

alter table public.staff_users drop constraint staff_users_role_check;
alter table public.staff_users add constraint staff_users_role_check
  check (role in ('super_admin', 'tenant_admin', 'manager', 'staff'));

comment on column public.staff_users.role is
  'super_admin (Splash360), tenant_admin (propriétaire), manager (gérant), staff (équipier, un restaurant).';
