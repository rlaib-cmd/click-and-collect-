-- Lot 10 : connexion du client par code à usage unique (SMS ou e-mail), ADR 0012.

-- Membres de démonstration : le téléphone devient l'identifiant principal (format E.164),
-- l'e-mail devient facultatif.
update public.loyalty_demo_members set phone = case
    when regexp_replace(phone, '[\s.\-()]', '', 'g') ~ '^0[1-9][0-9]{8}$'
      then '+33' || substr(regexp_replace(phone, '[\s.\-()]', '', 'g'), 2)
    when regexp_replace(phone, '[\s.\-()]', '', 'g') ~ '^\+33[1-9][0-9]{8}$'
      then regexp_replace(phone, '[\s.\-()]', '', 'g')
    else null
  end
where phone is not null;

-- Deux comptes avec le même numéro : seul le plus ancien le garde.
update public.loyalty_demo_members m set phone = null
where phone is not null and exists (
  select 1 from public.loyalty_demo_members o
  where o.tenant_id = m.tenant_id and o.phone = m.phone
    and (o.created_at, o.id) < (m.created_at, m.id)
);

alter table public.loyalty_demo_members
  alter column email drop not null,
  add constraint loyalty_demo_members_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  add constraint loyalty_demo_members_contact check (email is not null or phone is not null);

create unique index loyalty_demo_members_tenant_phone_idx
  on public.loyalty_demo_members (tenant_id, phone) where phone is not null;

-- Codes envoyés. Accès réservé au serveur : RLS activée, aucune règle pour anon/authenticated.
create table public.customer_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  -- Téléphone E.164 ou e-mail en minuscules.
  identifier text not null check (
    (channel = 'sms' and identifier ~ '^\+[1-9][0-9]{7,14}$')
    or (channel = 'email' and identifier = lower(identifier) and identifier ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  -- Empreinte du code (HMAC-SHA256 avec un secret serveur) : le code lui-même n'est jamais stocké.
  code_hash text not null check (length(code_hash) between 32 and 128),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_otp_challenges_lookup_idx
  on public.customer_otp_challenges (tenant_id, identifier, created_at desc);

alter table public.customer_otp_challenges enable row level security;

comment on table public.customer_otp_challenges is
  'Codes de connexion du client (lot 10). Lu et écrit uniquement par le serveur.';
