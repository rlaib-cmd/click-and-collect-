-- Lot 15 (ADR 0019) : « Ambassadeur » — le client partage son burger en story Instagram en
-- taguant l'enseigne et gagne un bonus de points, une fois par ticket.
-- La vérification automatique (mention Instagram, QR du ticket Splash360) sera branchée plus tard :
-- en attendant, une participation reste « pending » et aucun point n'est crédité.

create table public.ambassador_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  -- Compte Instagram à taguer, sans « @ » (règles Instagram : lettres, chiffres, point, tiret bas).
  instagram_handle text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  bonus_points integer not null default 50 check (bonus_points between 1 and 10000),
  updated_at timestamptz not null default now(),
  check (not enabled or instagram_handle is not null)
);

create table public.ambassador_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Identifiant du membre chez le fournisseur de fidélité (démo ou Splash360).
  member_id text not null check (length(member_id) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  -- Numéro du ticket de caisse, normalisé (majuscules, sans espaces) : une participation par ticket.
  ticket_ref text not null check (ticket_ref ~ '^[A-Z0-9-]{3,40}$'),
  -- Compte Instagram du client (sans « @ »), pour rapprocher la mention reçue.
  instagram_handle text not null check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  bonus_points integer not null check (bonus_points > 0),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (tenant_id, ticket_ref)
);

create index ambassador_entries_member_idx on public.ambassador_entries (tenant_id, member_id);
create index ambassador_entries_pending_idx on public.ambassador_entries (tenant_id, created_at)
  where status = 'pending';

-- Accès serveur uniquement (l'API passe par la clé de service) : aucune règle pour anon/authenticated.
alter table public.ambassador_settings enable row level security;
alter table public.ambassador_entries enable row level security;

-- Bills Burger (recette et démonstration) : compte à taguer, bonus de 50 points.
insert into public.ambassador_settings (tenant_id, enabled, instagram_handle, bonus_points)
select id, true, 'billsburgerfr', 50 from public.tenants where subdomain = 'billsburger'
on conflict (tenant_id) do nothing;
