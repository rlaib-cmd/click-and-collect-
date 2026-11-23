-- Lot 12, ADR 0016 : studio design. Le back-office modifie un brouillon, prévisualisé avant
-- publication ; l'application ne lit que la version publiée (colonnes de tenant_theme).

alter table public.tenant_theme
  add column draft jsonb check (draft is null or jsonb_typeof(draft) = 'object'),
  add column draft_updated_at timestamptz,
  add constraint tenant_theme_draft_dated check ((draft is null) = (draft_updated_at is null));

comment on column public.tenant_theme.draft is
  'Brouillon du design (mêmes réglages que la version publiée) ; null : rien en attente.';

-- Logos téléversés : bucket public en lecture, écrit uniquement par le serveur (clé de service).
-- Le schéma storage n'existe que sur Supabase (absent d'une base Postgres nue).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('brand-assets', 'brand-assets', true, 2097152,
            array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
