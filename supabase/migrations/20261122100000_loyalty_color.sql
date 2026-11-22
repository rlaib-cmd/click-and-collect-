-- Couleur du club fidélité (carte de membre, récompenses), choisie par l'enseigne au back-office.
-- null : la couleur principale de l'enseigne.

alter table public.tenant_theme
  add column loyalty_color text check (loyalty_color is null or loyalty_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.tenant_theme.loyalty_color is
  'Couleur du club fidélité ; null = couleur principale de l''enseigne.';
