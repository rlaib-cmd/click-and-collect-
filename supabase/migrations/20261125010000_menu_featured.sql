-- Mise en avant de produits sur l'accueil de l'application (retour du testeur Bills Burger) :
-- la marque choisit au back-office les produits qu'elle pousse « en ce moment ».
alter table public.menu_overrides add column featured boolean not null default false;

comment on column public.menu_overrides.featured is
  'Produit mis en avant sur l''accueil de l''application (carrousel « En ce moment »).';
