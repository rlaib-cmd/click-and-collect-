-- Lot 20 (ADR 0025), réponses de Splash360 du 25/11 :
-- * la référence d'un ticket est son `ticket_id` (UUID, imprimé en texte sur le ticket de caisse,
--   le même que dans l'export des ventes), et non plus le numéro de commande ;
-- * journée comptable : une vente avant 02:00 (heure de Paris) appartient à la veille ; l'heure
--   imprimée sur le ticket est donc gardée pour choisir la journée de l'export à lire ;
-- * pagination de l'export à partir de 1.

-- Participations déjà photographiées (lues avec l'ancien numéro) : sans identifiant de vente, elles
-- ne peuvent plus être vérifiées ; elles redeviennent « non vérifiées » et passent « à vérifier »
-- par l'équipe si elles sont encore en attente.
update public.ambassador_entries
  set needs_review = needs_review or status = 'pending'
  where ticket_check <> 'unverified';
update public.ambassador_entries
  set ticket_check = 'unverified', ticket_date = null, ticket_number = null,
    ticket_total_cents = null
  where ticket_check <> 'unverified';

alter table public.ambassador_entries
  drop constraint ambassador_entries_ticket_photo,
  drop column ticket_number,
  -- Identifiant Splash360 de la vente (lu sur la photo ou dans le QR de la borne).
  add column ticket_id uuid,
  -- Heure imprimée sur le ticket (HH:MM, heure de Paris), si lue : choisit la journée comptable.
  add column ticket_time text check (ticket_time is null or ticket_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Ticket à vérifier ⇔ identifiant connu ; journée, heure et total seulement avec un identifiant
  -- (ticket scanné : ni journée ni total, la journée vient de la date de participation).
  add constraint ambassador_entries_ticket_id check (
    (ticket_check = 'unverified') = (ticket_id is null)
    and (ticket_id is not null or (ticket_date is null and ticket_time is null
      and ticket_total_cents is null))
    and (ticket_time is null or ticket_date is not null)
  );

comment on column public.ambassador_entries.ticket_id is
  'Identifiant Splash360 de la vente (ticket_id de l''export), lu sur la photo ou le QR du ticket.';

-- Copie des ventes : le rapprochement se fait par identifiant de vente (clé primaire), le numéro
-- n'est plus utile.
alter table public.pos_sales drop column numero;

-- Pagination de l'export à partir de 1.
update public.pos_sales_sync set next_page = 1 where next_page < 1;
alter table public.pos_sales_sync
  drop constraint pos_sales_sync_next_page_check,
  alter column next_page set default 1,
  add constraint pos_sales_sync_next_page_check check (next_page between 1 and 10000);

-- Tickets à rapprocher : pris par ordre de participation (la journée dépend de l'heure ou du QR).
drop index public.ambassador_entries_ticket_pending_idx;
create index ambassador_entries_ticket_pending_idx on public.ambassador_entries (created_at)
  where status = 'pending' and ticket_check = 'pending';
