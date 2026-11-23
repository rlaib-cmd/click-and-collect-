-- ADR 0013 : l'e-mail devient facultatif à la commande ; le client final est identifié par son
-- e-mail s'il en donne un, sinon par son téléphone (clé calculée par @splash360/core).

alter table public.customers add column contact_key text;
update public.customers set contact_key = 'email:' || lower(email);

-- Filet de sécurité pour les insertions directes (seed, tests) : le serveur fournit toujours la clé.
create function public.customers_default_contact_key() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contact_key is null then
    new.contact_key := case
      when nullif(trim(new.email), '') is not null then 'email:' || lower(trim(new.email))
      else 'tel:' || regexp_replace(new.phone, '[^0-9+]', '', 'g')
    end;
  end if;
  return new;
end;
$$;

create trigger customers_contact_key before insert on public.customers
for each row execute function public.customers_default_contact_key();
alter table public.customers
  alter column contact_key set not null,
  add constraint customers_contact_key_format
    check (contact_key ~ '^(email:|tel:|supprime:).+'),
  alter column email drop not null;

alter table public.customers drop constraint customers_tenant_id_email_key;
alter table public.customers add constraint customers_tenant_contact_key unique (tenant_id, contact_key);

comment on column public.customers.contact_key is
  'Identité du client dans l''enseigne : email:<e-mail>, sinon tel:<téléphone> ; supprime:<id> après effacement.';

-- Réservations de points : commandes d'un membre avec récompense non encore réglée.
create index orders_loyalty_pending_idx on public.orders (tenant_id, loyalty_member_id)
  where loyalty_reward_id is not null and loyalty_settled_at is null;
