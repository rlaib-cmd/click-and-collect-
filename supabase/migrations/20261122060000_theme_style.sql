-- Style visuel de l'enseigne au-delà des couleurs (en-tête, angles, titres, motif).

alter table public.tenant_theme
  add column header_style text not null default 'plain' check (header_style in ('plain', 'brand')),
  add column corner_style text not null default 'rounded'
    check (corner_style in ('rounded', 'pill', 'square')),
  add column uppercase_titles boolean not null default false,
  add column pattern text not null default 'none' check (pattern in ('none', 'checker'));

comment on column public.tenant_theme.header_style is
  'plain : en-têtes sur le fond de l''application ; brand : sur la couleur de l''enseigne.';
comment on column public.tenant_theme.pattern is 'Motif décoratif sous les en-têtes.';
