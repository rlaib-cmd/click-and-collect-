-- Lot 21 (ADR 0026) : fidélité réelle YouFID (« SPLASH FID POS API »).
-- Trois tables, lues et écrites par le serveur uniquement (RLS sans politique).

-- Lien client YouFID ↔ application. YouFID ne retrouve un client que par QR code ou e-mail
-- (route 3) : on garde le QR code de chaque usr_id. E-mail et date de naissance sont la copie
-- de ce que le membre a saisi dans l'application (la route 3 ne les renvoie pas).
create table public.loyalty_members_youfid (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  usr_id text not null check (usr_id ~ '^[0-9]{1,18}$'),
  qr_code text not null check (length(qr_code) between 1 and 100),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (email is null or length(email) between 3 and 254),
  birth_date date check (birth_date is null or birth_date between '1900-01-01' and current_date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, usr_id)
);
create index loyalty_members_youfid_phone_idx
  on public.loyalty_members_youfid (tenant_id, phone) where phone is not null;
create index loyalty_members_youfid_recent_idx
  on public.loyalty_members_youfid (tenant_id, created_at desc);
alter table public.loyalty_members_youfid enable row level security;
comment on table public.loyalty_members_youfid is
  'Lot 21 : lien usr_id YouFID → QR code (et copie du profil saisi dans l''app) ; serveur uniquement.';

-- Registre des opérations de points faites par l'application. L'API YouFID n'a pas de clé
-- d'idempotence : la clé unique (tenant_id, op_key) garantit qu'une commande ne crédite qu'une
-- fois. Aucune donnée personnelle : identifiants techniques, points, libellé, code d'erreur.
create table public.loyalty_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  op_key text not null check (length(op_key) between 1 and 200),
  kind text not null check (kind in ('earn', 'redeem', 'welcome', 'bonus', 'adjust')),
  member_id text not null check (length(member_id) between 1 and 100),
  -- Commande à l'origine de l'opération (sans clé étrangère : le registre survit à la commande).
  order_id uuid,
  points integer not null,
  label text not null check (length(label) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed', 'uncertain', 'resolved')),
  error text check (error is null or length(error) <= 200),
  response_points integer,
  attempts integer not null default 1 check (attempts >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, op_key)
);
create index loyalty_operations_member_idx
  on public.loyalty_operations (tenant_id, member_id, created_at desc);
create index loyalty_operations_review_idx
  on public.loyalty_operations (tenant_id, updated_at desc) where status in ('failed', 'uncertain');
alter table public.loyalty_operations enable row level security;
comment on table public.loyalty_operations is
  'Lot 21 : registre des opérations de points envoyées à YouFID (exactement une fois) ; serveur uniquement.';

-- Réglages que l'API ne fournit pas : points par euro (affichage, estimation) et points de
-- bienvenue (crédités par forced_amount à l'inscription). Défauts décidés le 25/11 : 10 et 100.
create table public.loyalty_program_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  points_per_euro integer not null default 10 check (points_per_euro between 0 and 1000),
  welcome_points integer not null default 100 check (welcome_points between 0 and 100000),
  updated_at timestamptz not null default now()
);
alter table public.loyalty_program_settings enable row level security;
comment on table public.loyalty_program_settings is
  'Lot 21 : points par euro et points de bienvenue de l''enseigne (YouFID) ; serveur uniquement.';
