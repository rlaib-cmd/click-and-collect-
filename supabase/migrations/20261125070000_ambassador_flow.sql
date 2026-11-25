-- Lot 17 (ADR 0022) : « Ambassadeur » complet.
-- * Délais réglables par enseigne : contrôle de la story à mention + 20 h, crédit à mention + 24 h.
-- * Catégorie de l'enseigne (burgers, pizza…) : contexte de l'analyse de la photo.
-- * Compte Instagram du membre mémorisé (saisi une fois, modifiable).
-- * Étapes d'une participation (mention reçue, contrôle, verdict photo) et historique complet.

alter table public.ambassador_settings
  add column check_after_hours integer not null default 20 check (check_after_hours between 1 and 72),
  add column credit_after_hours integer not null default 24 check (credit_after_hours between 1 and 168),
  add column photo_category text not null default 'restaurant'
    check (length(photo_category) between 2 and 60),
  add constraint ambassador_settings_delays check (check_after_hours <= credit_after_hours);

alter table public.ambassador_entries
  -- Mention de l'enseigne constatée (bouton « Mention reçue » en attendant Meta) : début du délai.
  add column mention_received_at timestamptz,
  add column mention_by text check (mention_by is null or length(mention_by) between 1 and 200),
  -- Contrôle « la story est-elle toujours en ligne ? » prévu à mention + check_after_hours.
  add column check_due_at timestamptz,
  add column checked_at timestamptz,
  add column check_result text check (check_result in ('online', 'removed')),
  -- Crédit prévu (mention + credit_after_hours), figé au moment de la mention.
  add column credit_due_at timestamptz,
  -- Verdict de l'analyse de la photo (IA ou vérification manuelle) et sa raison.
  add column photo_verdict text check (photo_verdict in ('accepted', 'rejected', 'doubtful')),
  add column photo_reason text check (photo_reason is null or length(photo_reason) <= 300),
  -- À vérifier par l'équipe (photo douteuse ou non analysée).
  add column needs_review boolean not null default false,
  add constraint ambassador_entries_due check (
    (mention_received_at is null) = (credit_due_at is null)
    and (mention_received_at is null) = (check_due_at is null)
    and (check_due_at is null or check_due_at <= credit_due_at)
  ),
  add constraint ambassador_entries_checked check ((checked_at is null) = (check_result is null));

-- Participations dont un contrôle ou un crédit est à faire (tâche périodique).
create index ambassador_entries_due_idx on public.ambassador_entries (check_due_at, credit_due_at)
  where status = 'pending' and mention_received_at is not null;

-- Compte Instagram du membre, saisi une fois et mémorisé (une ligne par membre et par enseigne).
create table public.ambassador_profiles (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  member_id text not null check (length(member_id) between 1 and 100),
  instagram_handle text not null check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

-- Historique complet d'une participation (une participation par achat, chaque étape tracée).
create table public.ambassador_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entry_id uuid not null references public.ambassador_entries (id) on delete cascade,
  type text not null check (type in (
    'created', 'photo_checked', 'mention_received', 'story_checked', 'credited', 'credit_failed',
    'rejected'
  )),
  -- Auteur : « client », « système », « IA » ou l'e-mail du membre de l'équipe.
  actor text not null check (length(actor) between 1 and 200),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index ambassador_events_entry_idx on public.ambassador_events (tenant_id, entry_id, at);

-- Un événement appartient à la même enseigne que sa participation.
create or replace function public.ambassador_event_same_tenant() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.ambassador_entries e where e.id = new.entry_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'ambassador_events: enseigne différente de la participation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger ambassador_event_same_tenant before insert or update on public.ambassador_events
  for each row execute function public.ambassador_event_same_tenant();

-- Accès serveur uniquement : aucune règle pour anon/authenticated.
alter table public.ambassador_profiles enable row level security;
alter table public.ambassador_events enable row level security;

-- Bills Burger : enseigne de burgers.
update public.ambassador_settings s set photo_category = 'burgers'
from public.tenants t where t.id = s.tenant_id and t.subdomain = 'billsburger';
