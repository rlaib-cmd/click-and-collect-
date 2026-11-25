-- Lot 20 (ADR 0025) : « Achat vérifié » — le client photographie son ticket de caisse, l'IA en lit
-- le numéro de commande, la journée et le total, et le serveur vérifie auprès de l'export des
-- ventes Splash360 que la commande a bien été encaissée.

-- État de la vérification du ticket d'une participation :
-- * unverified : ticket scanné (QR) ou saisi, jamais vérifié (comportement des lots 15 et 17) ;
-- * pending    : ticket photographié, en attente du rapprochement avec les ventes ;
-- * verified   : vente encaissée trouvée (même journée, même numéro, même total) ;
-- * unpaid     : seule une vente annulée correspond (participation refusée automatiquement) ;
-- * not_found  : journée entièrement lue, aucune vente ne correspond (l'équipe tranche).
alter table public.ambassador_entries
  add column ticket_check text not null default 'unverified'
    check (ticket_check in ('unverified', 'pending', 'verified', 'unpaid', 'not_found')),
  -- Données lues sur la photo du ticket (signées par le serveur) ; nulles sinon.
  add column ticket_date date,
  add column ticket_number text check (ticket_number is null or ticket_number ~ '^[A-Z0-9/-]{1,20}$'),
  add column ticket_total_cents integer check (ticket_total_cents is null or ticket_total_cents between 0 and 10000000),
  add constraint ambassador_entries_ticket_photo check (
    (ticket_check = 'unverified') = (ticket_date is null)
    and (ticket_date is null) = (ticket_number is null)
    and (ticket_date is null) = (ticket_total_cents is null)
  );

comment on column public.ambassador_entries.ticket_check is
  'Vérification du ticket photographié : unverified, pending, verified, unpaid, not_found (ADR 0025).';

-- Tickets à rapprocher (tâche périodique).
create index ambassador_entries_ticket_pending_idx on public.ambassador_entries (ticket_date, created_at)
  where status = 'pending' and ticket_check = 'pending';

-- Nouveaux événements : lecture du ticket et résultat du rapprochement.
alter table public.ambassador_events drop constraint ambassador_events_type_check;
alter table public.ambassador_events add constraint ambassador_events_type_check check (type in (
  'created', 'photo_checked', 'mention_received', 'story_checked', 'credited', 'credit_failed',
  'rejected', 'ticket_read', 'ticket_checked'
));

-- Copie minimale de l'export des ventes Splash360, pour le rapprochement seulement : ni client,
-- ni lignes, ni règlements. Une ligne par vente, rattachée à l'enseigne du restaurant.
create table public.pos_sales (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  ticket_id text not null check (length(ticket_id) between 1 and 64),
  -- Identifiant Splash360 du restaurant (comme restaurants.splash360_id).
  splash360_restaurant_id text not null check (length(splash360_restaurant_id) between 1 and 64),
  jour_comptable date not null,
  -- Numéro de commande normalisé (majuscules, sans espaces ni zéros de tête).
  numero text not null check (length(numero) between 1 and 20),
  status text not null check (status in ('confirmed', 'deleted')),
  total_cents integer not null,
  synced_at timestamptz not null default now(),
  primary key (tenant_id, ticket_id)
);
create index pos_sales_match_idx on public.pos_sales (tenant_id, jour_comptable, numero);

-- Avancement de la lecture de l'export, par enseigne et par journée comptable.
-- Une journée n'est « complète » qu'après une lecture entière commencée une fois la journée
-- terminée (heure de Paris) : l'ordre des ventes dans l'export n'est pas garanti.
create table public.pos_sales_sync (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  jour date not null,
  next_page integer not null default 0 check (next_page between 0 and 10000),
  -- La lecture en cours a commencé après la fin de la journée.
  pass_after_day boolean not null default false,
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, jour)
);

-- Accès serveur uniquement : aucune règle pour anon/authenticated.
alter table public.pos_sales enable row level security;
alter table public.pos_sales_sync enable row level security;
