-- ADR 0015 : un code promo n'est consommé que par une commande qui aboutit.
-- Annulation, paiement refusé ou remboursement : l'utilisation est rendue au client.

create function public.release_promo_redemption() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'payment_failed', 'refunded') and new.status <> old.status then
    delete from public.promo_redemptions where order_id = new.id;
  end if;
  return new;
end;
$$;

create trigger orders_release_promo after update of status on public.orders
for each row execute function public.release_promo_redemption();
