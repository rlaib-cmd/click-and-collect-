-- Index des clés étrangères signalés par l'outil de conseil Supabase (audit du 25/11).
-- Sans effet visible au volume de la recette ; évite des parcours complets de table en production
-- (suppressions en cascade, jointures par enseigne).
create index if not exists audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index if not exists closures_tenant_id_idx on public.closures (tenant_id);
create index if not exists delivery_zones_tenant_id_idx on public.delivery_zones (tenant_id);
create index if not exists loyalty_demo_movements_tenant_id_idx on public.loyalty_demo_movements (tenant_id);
create index if not exists menu_overrides_tenant_id_idx on public.menu_overrides (tenant_id);
create index if not exists opening_hours_tenant_id_idx on public.opening_hours (tenant_id);
create index if not exists order_events_tenant_id_idx on public.order_events (tenant_id);
create index if not exists order_item_options_tenant_id_idx on public.order_item_options (tenant_id);
create index if not exists order_items_tenant_id_idx on public.order_items (tenant_id);
create index if not exists order_push_tokens_tenant_id_idx on public.order_push_tokens (tenant_id);
create index if not exists orders_delivery_zone_id_idx on public.orders (delivery_zone_id);
create index if not exists pos_dispatches_tenant_id_idx on public.pos_dispatches (tenant_id);
create index if not exists promo_redemptions_tenant_id_idx on public.promo_redemptions (tenant_id);
create index if not exists restaurant_settings_tenant_id_idx on public.restaurant_settings (tenant_id);
create index if not exists staff_users_restaurant_id_idx on public.staff_users (restaurant_id);
create index if not exists staff_users_tenant_id_idx on public.staff_users (tenant_id);
