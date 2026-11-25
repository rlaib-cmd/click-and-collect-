-- Audit de sécurité du 25/11 (M4) : version de session des membres du club. Chaque connexion
-- confirmée par code l'incrémente ; les jetons d'une version antérieure sont refusés (un jeton
-- obtenu par une adhésion frauduleuse ne survit pas à la connexion du vrai titulaire).
create table public.loyalty_member_sessions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  member_id text not null check (length(member_id) between 1 and 100),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

alter table public.loyalty_member_sessions enable row level security;

comment on table public.loyalty_member_sessions is
  'Version de session par membre du club ; lue et écrite par le serveur uniquement (pas de politique).';
