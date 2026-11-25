import type { PosPhase } from './pos';
import type { StaffRole, TenantRole } from '@splash360/core';
import type { Queryable, Sql } from './client';
import { toThemeStyle, type ThemeStyle, type ThemeStyleRow } from './tenants';

export type { StaffRole } from '@splash360/core';

export interface StaffUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: StaffRole;
  readonly tenantId: string | null;
  readonly restaurantId: string | null;
}

/** Compte vu de la page Équipe : désactivé, ou invité sans s'être encore connecté. */
export interface TeamMember extends StaffUser {
  readonly disabled: boolean;
  readonly pending: boolean;
}

export interface AuditEntry {
  readonly tenantId: string | null;
  readonly actor: StaffUser;
  readonly action: string;
  readonly target?: string | null;
  readonly detail?: Record<string, unknown> | null;
}

export interface OrderListItem {
  readonly id: string;
  readonly number: number;
  readonly restaurantId: string;
  readonly status: string;
  readonly mode: 'pickup' | 'delivery';
  readonly customerName: string;
  readonly totalCents: number;
  readonly estimatedAt: string;
  readonly createdAt: string;
  readonly itemCount: number;
  readonly paymentMethod: 'online' | 'on_site';
  /** Avancement en caisse Splash360 (ADR 0018) ; null si pas encore déposée. */
  readonly posPhase: PosPhase | null;
}

export interface RestaurantSettingsRecord {
  readonly pickupEnabled: boolean;
  /** Paiement sur place accepté, pour les membres du club (ADR 0010). */
  readonly payOnSiteEnabled?: boolean;
  readonly deliveryEnabled: boolean;
  readonly prepMinutes: number;
  readonly deliveryMinutes: number;
  readonly slotStepMinutes: 10 | 15 | 30;
  readonly maxOrdersPerSlot: number | null;
  readonly daysAhead: number;
  readonly deliveryMinimumCents: number;
  readonly freeDeliveryThresholdCents: number | null;
  readonly serviceFeeCents: number;
  readonly openingHours: readonly { isoWeekday: number; opens: string; closes: string }[];
  readonly closures: readonly { day: string; reason: string | null }[];
  readonly zones: readonly {
    name: string;
    kind: 'radius' | 'postal_codes';
    radiusMeters: number | null;
    postalCodes: readonly string[];
    feeCents: number;
  }[];
}

export interface DashboardStats {
  readonly revenueCents: number;
  readonly orders: number;
  readonly averageBasketCents: number;
  readonly byMode: { readonly pickup: number; readonly delivery: number };
  readonly byDay: readonly { day: string; orders: number; revenueCents: number }[];
  readonly byRestaurant: readonly {
    restaurantId: string;
    name: string;
    orders: number;
    revenueCents: number;
  }[];
}

export interface CustomerRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string;
  readonly marketingConsent: boolean;
  readonly orders: number;
  readonly spentCents: number;
  readonly lastOrderAt: string | null;
}

export interface TenantSummary {
  readonly id: string;
  readonly name: string;
  readonly subdomain: string;
  readonly splash360Id: string;
  readonly status: 'active' | 'suspended';
  readonly applicationFeeBps: number;
  readonly applicationFeeFixedCents: number;
  readonly restaurants: number;
  /** Console Splash360 (lot 13) : brouillon de design en attente, propriétaire déjà connecté. */
  readonly hasDraft: boolean;
  readonly ownerActive: boolean;
  readonly primaryColor: string | null;
  readonly logoUrl: string | null;
}

/** Statuts comptés dans le chiffre d'affaires : payées et au-delà (remboursements déduits). */
const REVENUE_STATUSES = [
  'paid',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'refunded',
];

/**
 * Commande comptée dans le chiffre d'affaires : payée en ligne (et au-delà), ou payée sur place,
 * c'est-à-dire remise au client (ADR 0010).
 */
const revenue = (sql: Sql) =>
  sql`((o.payment_method = 'online' and o.status in ${sql(REVENUE_STATUSES)})
       or (o.payment_method = 'on_site' and o.status = 'completed'))`;

const toStaff = (r: {
  id: string;
  email: string;
  name: string | null;
  role: StaffRole;
  tenant_id: string | null;
  restaurant_id: string | null;
}): StaffUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  tenantId: r.tenant_id,
  restaurantId: r.restaurant_id,
});

/** Design d'une enseigne, tel qu'édité au back-office. */
export interface ThemeRecord {
  primaryColor: string;
  mode: 'light' | 'dark';
  logoUrl: string | null;
  tagline: string | null;
  style: ThemeStyle;
  /** Couleur du club fidélité ; null : couleur de l'enseigne. */
  loyaltyColor: string | null;
}

export interface AdminStore {
  /**
   * Retrouve les comptes d'un utilisateur connecté. À la première connexion, rattache les
   * invitations en attente à son identifiant Auth, seulement si son adresse est confirmée
   * (`attachPending`). Un conflit de rattachement n'empêche jamais la connexion (audit H1).
   */
  resolveStaff(authUserId: string, email: string, attachPending?: boolean): Promise<StaffUser[]>;
  listStaff(tenantId: string): Promise<TeamMember[]>;
  /** Change le rôle (et le restaurant) d'un compte de l'enseigne ; jamais un super-administrateur. */
  updateStaffRole(
    tenantId: string,
    staffId: string,
    role: TenantRole,
    restaurantId: string | null,
  ): Promise<boolean>;
  inviteStaff(input: {
    tenantId: string;
    email: string;
    name: string | null;
    role: TenantRole;
    restaurantId: string | null;
  }): Promise<StaffUser>;
  setStaffDisabled(tenantId: string, staffId: string, disabled: boolean): Promise<boolean>;
  /** Supprime un compte de l'équipe de l'enseigne (jamais un super-administrateur). */
  deleteStaff(tenantId: string, staffId: string): Promise<boolean>;

  audit(entry: AuditEntry): Promise<void>;
  listAudit(
    tenantId: string,
    limit: number,
  ): Promise<
    { action: string; actorEmail: string; target: string | null; detail: unknown; at: string }[]
  >;

  listOrders(
    tenantId: string,
    filter: {
      restaurantId?: string | undefined;
      statuses?: readonly string[] | undefined;
      since?: Date | undefined;
      limit: number;
    },
  ): Promise<OrderListItem[]>;
  setRestaurantStatus(
    tenantId: string,
    restaurantId: string,
    status: 'active' | 'paused',
  ): Promise<boolean>;

  getTheme(tenantId: string): Promise<ThemeRecord | null>;
  updateTheme(tenantId: string, theme: ThemeRecord): Promise<void>;
  /** Brouillon du design (lot 12) : contenu brut, validé par l'API ; null si rien en attente. */
  getThemeDraft(tenantId: string): Promise<{ draft: unknown; updatedAt: string } | null>;
  /** Enregistre le brouillon, ou l'efface (null). */
  setThemeDraft(tenantId: string, draft: ThemeRecord | null): Promise<void>;
  /** Publie le design donné et efface le brouillon, en une transaction. */
  publishTheme(tenantId: string, theme: ThemeRecord): Promise<void>;
  getLegalText(tenantId: string): Promise<string | null>;
  setLegalText(tenantId: string, text: string | null): Promise<void>;

  getSettings(tenantId: string, restaurantId: string): Promise<RestaurantSettingsRecord | null>;
  saveSettings(
    tenantId: string,
    restaurantId: string,
    settings: RestaurantSettingsRecord,
  ): Promise<void>;

  listMenuOverrides(
    tenantId: string,
    restaurantId: string,
  ): Promise<
    {
      kind: 'category' | 'product';
      itemId: string;
      hidden: boolean;
      position: number | null;
      featured: boolean;
    }[]
  >;
  /** `featured` absent : la mise en avant enregistrée est conservée. */
  setMenuOverride(
    tenantId: string,
    restaurantId: string,
    o: {
      kind: 'category' | 'product';
      itemId: string;
      hidden: boolean;
      position: number | null;
      featured?: boolean | undefined;
    },
  ): Promise<void>;

  dashboard(tenantId: string, from: Date, to: Date, restaurantId?: string): Promise<DashboardStats>;

  listCustomers(tenantId: string, search: string | null, limit: number): Promise<CustomerRow[]>;
  /** Droit à l'effacement : coordonnées anonymisées, commandes conservées pour la comptabilité. */
  anonymizeCustomer(tenantId: string, customerId: string): Promise<boolean>;

  listTenants(): Promise<TenantSummary[]>;
  createTenant(input: {
    name: string;
    subdomain: string;
    splash360Id: string;
    adminEmail: string;
  }): Promise<{ tenantId: string }>;
  updateTenant(
    tenantId: string,
    input: {
      status?: 'active' | 'suspended' | undefined;
      applicationFeeBps?: number | undefined;
      applicationFeeFixedCents?: number | undefined;
    },
  ): Promise<boolean>;
  /**
   * Supprime une enseigne et tout ce qui lui appartient. Refusé si elle a des commandes :
   * elles sont conservées pour la comptabilité (on bloque alors l'enseigne).
   */
  deleteTenant(tenantId: string): Promise<'deleted' | 'not_found' | 'has_orders'>;
}

export function createPostgresAdminStore(sql: Sql): AdminStore {
  return {
    async resolveStaff(authUserId, email, attachPending = true) {
      const normalized = email.toLowerCase();
      if (attachPending) {
        // Une invitation par enseigne : rattachées une à une, un conflit n'en bloque aucune autre.
        const pending = await sql<{ id: string }[]>`
          select id from public.staff_users
          where email = ${normalized} and auth_user_id is null and not disabled`;
        for (const p of pending) {
          await sql`update public.staff_users set auth_user_id = ${authUserId}
                    where id = ${p.id} and auth_user_id is null`.catch(() => undefined);
        }
      }
      const rows = await sql<Parameters<typeof toStaff>[0][]>`
        select id, email, name, role, tenant_id, restaurant_id from public.staff_users
        where auth_user_id = ${authUserId} and not disabled
        order by role, created_at`;
      return rows.map(toStaff);
    },

    async listStaff(tenantId) {
      const rows = await sql<
        (Parameters<typeof toStaff>[0] & { disabled: boolean; pending: boolean })[]
      >`
        select id, email, name, role, tenant_id, restaurant_id, disabled, auth_user_id is null as pending
        from public.staff_users
        where tenant_id = ${tenantId} order by role, email`;
      return rows.map((r) => ({ ...toStaff(r), disabled: r.disabled, pending: r.pending }));
    },

    async updateStaffRole(tenantId, staffId, role, restaurantId) {
      const r =
        await sql`update public.staff_users set role = ${role}, restaurant_id = ${restaurantId}
                          where tenant_id = ${tenantId} and id = ${staffId} and role <> 'super_admin'`;
      return r.count === 1;
    },

    async inviteStaff(input) {
      const [row] = await sql<Parameters<typeof toStaff>[0][]>`
        insert into public.staff_users (tenant_id, restaurant_id, email, name, role)
        values (${input.tenantId}, ${input.restaurantId}, ${input.email.toLowerCase()}, ${input.name}, ${input.role})
        returning id, email, name, role, tenant_id, restaurant_id`;
      if (!row) throw new Error('Invitation impossible');
      return toStaff(row);
    },

    async setStaffDisabled(tenantId, staffId, disabled) {
      const r =
        await sql`update public.staff_users set disabled = ${disabled} where tenant_id = ${tenantId} and id = ${staffId}`;
      return r.count === 1;
    },

    async deleteStaff(tenantId, staffId) {
      const r = await sql`delete from public.staff_users
                          where tenant_id = ${tenantId} and id = ${staffId} and role <> 'super_admin'`;
      return r.count === 1;
    },

    async audit(e) {
      await sql`insert into public.audit_logs (tenant_id, actor_id, actor_email, action, target, detail)
                values (${e.tenantId}, ${e.actor.id}, ${e.actor.email}, ${e.action}, ${e.target ?? null},
                        ${e.detail ? sql.json(e.detail as Parameters<typeof sql.json>[0]) : null})`;
    },

    async listAudit(tenantId, limit) {
      const rows = await sql<
        {
          action: string;
          actor_email: string;
          target: string | null;
          detail: unknown;
          created_at: Date;
        }[]
      >`
        select action, actor_email, target, detail, created_at from public.audit_logs
        where tenant_id = ${tenantId} order by created_at desc limit ${limit}`;
      return rows.map((r) => ({
        action: r.action,
        actorEmail: r.actor_email,
        target: r.target,
        detail: r.detail,
        at: r.created_at.toISOString(),
      }));
    },

    async listOrders(tenantId, f) {
      const rows = await sql<
        {
          id: string;
          number: number;
          restaurant_id: string;
          status: string;
          mode: 'pickup' | 'delivery';
          customer_name: string;
          total_cents: number;
          estimated_at: Date;
          created_at: Date;
          item_count: number;
          payment_method: 'online' | 'on_site';
          pos_phase: PosPhase | null;
        }[]
      >`
        select o.id, o.number, o.restaurant_id, o.status, o.mode, o.payment_method, o.pos_phase,
               c.name as customer_name, o.total_cents,
               o.estimated_at, o.created_at,
               (select coalesce(sum(quantity), 0)::int from public.order_items i where i.order_id = o.id) as item_count
        from public.orders o join public.customers c on c.id = o.customer_id
        where o.tenant_id = ${tenantId}
          ${f.restaurantId ? sql`and o.restaurant_id = ${f.restaurantId}` : sql``}
          ${f.statuses && f.statuses.length > 0 ? sql`and o.status in ${sql(f.statuses)}` : sql``}
          ${f.since ? sql`and o.created_at >= ${f.since}` : sql``}
        order by o.estimated_at asc
        limit ${f.limit}`;
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        restaurantId: r.restaurant_id,
        status: r.status,
        mode: r.mode,
        customerName: r.customer_name,
        totalCents: r.total_cents,
        estimatedAt: r.estimated_at.toISOString(),
        createdAt: r.created_at.toISOString(),
        itemCount: r.item_count,
        paymentMethod: r.payment_method,
        posPhase: r.pos_phase,
      }));
    },

    async setRestaurantStatus(tenantId, restaurantId, status) {
      const r = await sql`update public.restaurants set status = ${status}
                          where tenant_id = ${tenantId} and id = ${restaurantId} and status <> 'closed'`;
      return r.count === 1;
    },

    async getTheme(tenantId) {
      const [r] = await sql<
        ({
          primary_color: string;
          mode: 'light' | 'dark';
          logo_url: string | null;
          tagline: string | null;
          loyalty_color: string | null;
        } & ThemeStyleRow)[]
      >`
        select primary_color, mode, logo_url, tagline, loyalty_color, header_style, corner_style, uppercase_titles, pattern
        from public.tenant_theme where tenant_id = ${tenantId}`;
      return r
        ? {
            primaryColor: r.primary_color,
            mode: r.mode,
            logoUrl: r.logo_url,
            tagline: r.tagline,
            style: toThemeStyle(r),
            loyaltyColor: r.loyalty_color,
          }
        : null;
    },

    async updateTheme(tenantId, t) {
      await upsertTheme(sql, tenantId, t);
    },

    async getThemeDraft(tenantId) {
      const [r] = await sql<{ draft: unknown; draft_updated_at: Date | null }[]>`
        select draft, draft_updated_at from public.tenant_theme where tenant_id = ${tenantId}`;
      return r?.draft && r.draft_updated_at
        ? { draft: r.draft, updatedAt: r.draft_updated_at.toISOString() }
        : null;
    },

    async setThemeDraft(tenantId, draft) {
      await sql`insert into public.tenant_theme (tenant_id, draft, draft_updated_at)
                values (${tenantId}, ${draft ? sql.json(toJson(draft)) : null}, ${draft ? new Date() : null})
                on conflict (tenant_id) do update set draft = excluded.draft,
                  draft_updated_at = excluded.draft_updated_at`;
    },

    async publishTheme(tenantId, t) {
      await sql.begin(async (tx) => {
        await upsertTheme(tx, tenantId, t);
        await tx`update public.tenant_theme set draft = null, draft_updated_at = null
                 where tenant_id = ${tenantId}`;
      });
    },

    async getLegalText(tenantId) {
      const [r] = await sql<
        { legal_text: string | null }[]
      >`select legal_text from public.tenants where id = ${tenantId}`;
      return r?.legal_text ?? null;
    },

    async setLegalText(tenantId, text) {
      await sql`update public.tenants set legal_text = ${text} where id = ${tenantId}`;
    },

    async getSettings(tenantId, restaurantId) {
      const [s] = await sql<
        {
          pickup_enabled: boolean;
          delivery_enabled: boolean;
          pay_on_site_enabled: boolean;
          prep_minutes: number;
          delivery_minutes: number;
          slot_step_minutes: 10 | 15 | 30;
          max_orders_per_slot: number | null;
          days_ahead: number;
          delivery_minimum_cents: number;
          free_delivery_threshold_cents: number | null;
          service_fee_cents: number;
        }[]
      >`select * from public.restaurant_settings where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`;
      if (!s) return null;
      const [hours, closures, zones] = await Promise.all([
        sql<{ iso_weekday: number; opens: string; closes: string }[]>`
          select iso_weekday, to_char(opens, 'HH24:MI') as opens, to_char(closes, 'HH24:MI') as closes
          from public.opening_hours where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}
          order by iso_weekday, opens`,
        sql<{ day: string; reason: string | null }[]>`
          select day::text, reason from public.closures
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId} and day >= current_date order by day`,
        sql<
          {
            name: string;
            kind: 'radius' | 'postal_codes';
            radius_meters: number | null;
            postal_codes: string[];
            fee_cents: number;
          }[]
        >`
          select name, kind, radius_meters, postal_codes, fee_cents from public.delivery_zones
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId} and not archived order by fee_cents`,
      ]);
      return {
        pickupEnabled: s.pickup_enabled,
        payOnSiteEnabled: s.pay_on_site_enabled,
        deliveryEnabled: s.delivery_enabled,
        prepMinutes: s.prep_minutes,
        deliveryMinutes: s.delivery_minutes,
        slotStepMinutes: s.slot_step_minutes,
        maxOrdersPerSlot: s.max_orders_per_slot,
        daysAhead: s.days_ahead,
        deliveryMinimumCents: s.delivery_minimum_cents,
        freeDeliveryThresholdCents: s.free_delivery_threshold_cents,
        serviceFeeCents: s.service_fee_cents,
        openingHours: hours.map((h) => ({
          isoWeekday: h.iso_weekday,
          opens: h.opens,
          closes: h.closes,
        })),
        closures,
        zones: zones.map((z) => ({
          name: z.name,
          kind: z.kind,
          radiusMeters: z.radius_meters,
          postalCodes: z.postal_codes,
          feeCents: z.fee_cents,
        })),
      };
    },

    async saveSettings(tenantId, restaurantId, s) {
      await sql.begin(async (tx) => {
        await tx`
          insert into public.restaurant_settings (restaurant_id, tenant_id, pickup_enabled, delivery_enabled, prep_minutes,
            delivery_minutes, slot_step_minutes, max_orders_per_slot, days_ahead, delivery_minimum_cents,
            free_delivery_threshold_cents, service_fee_cents, pay_on_site_enabled)
          values (${restaurantId}, ${tenantId}, ${s.pickupEnabled}, ${s.deliveryEnabled}, ${s.prepMinutes}, ${s.deliveryMinutes},
            ${s.slotStepMinutes}, ${s.maxOrdersPerSlot}, ${s.daysAhead}, ${s.deliveryMinimumCents},
            ${s.freeDeliveryThresholdCents}, ${s.serviceFeeCents}, ${s.payOnSiteEnabled ?? false})
          on conflict (restaurant_id) do update set
            pickup_enabled = excluded.pickup_enabled, delivery_enabled = excluded.delivery_enabled,
            prep_minutes = excluded.prep_minutes, delivery_minutes = excluded.delivery_minutes,
            slot_step_minutes = excluded.slot_step_minutes, max_orders_per_slot = excluded.max_orders_per_slot,
            days_ahead = excluded.days_ahead, delivery_minimum_cents = excluded.delivery_minimum_cents,
            free_delivery_threshold_cents = excluded.free_delivery_threshold_cents, service_fee_cents = excluded.service_fee_cents,
            pay_on_site_enabled = excluded.pay_on_site_enabled`;
        await tx`delete from public.opening_hours where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`;
        for (const h of s.openingHours) {
          await tx`insert into public.opening_hours (tenant_id, restaurant_id, iso_weekday, opens, closes)
                   values (${tenantId}, ${restaurantId}, ${h.isoWeekday}, ${h.opens}::time, ${h.closes}::time)`;
        }
        await tx`delete from public.closures where tenant_id = ${tenantId} and restaurant_id = ${restaurantId} and day >= current_date`;
        for (const c of s.closures) {
          await tx`insert into public.closures (tenant_id, restaurant_id, day, reason)
                   values (${tenantId}, ${restaurantId}, ${c.day}::date, ${c.reason}) on conflict do nothing`;
        }
        // Les commandes gardent leur zone : supprimée si inutilisée, sinon archivée.
        await tx`delete from public.delivery_zones z where z.tenant_id = ${tenantId} and z.restaurant_id = ${restaurantId}
                 and not exists (select 1 from public.orders o where o.delivery_zone_id = z.id)`;
        await tx`update public.delivery_zones set archived = true where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`;
        for (const z of s.zones) {
          await tx`insert into public.delivery_zones (tenant_id, restaurant_id, name, kind, radius_meters, postal_codes, fee_cents)
                   values (${tenantId}, ${restaurantId}, ${z.name}, ${z.kind}, ${z.radiusMeters}, ${[...z.postalCodes]}, ${z.feeCents})`;
        }
      });
    },

    async listMenuOverrides(tenantId, restaurantId) {
      const rows = await sql<
        {
          item_kind: 'category' | 'product';
          item_id: string;
          hidden: boolean;
          position: number | null;
          featured: boolean;
        }[]
      >`
        select item_kind, item_id, hidden, position, featured from public.menu_overrides
        where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}`;
      return rows.map((r) => ({
        kind: r.item_kind,
        itemId: r.item_id,
        hidden: r.hidden,
        position: r.position,
        featured: r.featured,
      }));
    },

    async setMenuOverride(tenantId, restaurantId, o) {
      const featured = o.featured ?? null;
      await sql`insert into public.menu_overrides (tenant_id, restaurant_id, item_kind, item_id, hidden, position, featured)
                values (${tenantId}, ${restaurantId}, ${o.kind}, ${o.itemId}, ${o.hidden}, ${o.position}, coalesce(${featured}::boolean, false))
                on conflict (restaurant_id, item_kind, item_id) do update set hidden = excluded.hidden, position = excluded.position,
                  featured = coalesce(${featured}::boolean, public.menu_overrides.featured)`;
    },

    async dashboard(tenantId, from, to, restaurantId) {
      const scope = sql`o.tenant_id = ${tenantId} and ${revenue(sql)}
        and o.created_at >= ${from} and o.created_at < ${to}
        ${restaurantId ? sql`and o.restaurant_id = ${restaurantId}` : sql``}`;
      const [totals, byDay, byRestaurant] = await Promise.all([
        sql<{ revenue: number; orders: number; pickup: number; delivery: number }[]>`
          select coalesce(sum(o.total_cents - o.refunded_cents), 0)::int as revenue, count(*)::int as orders,
                 count(*) filter (where o.mode = 'pickup')::int as pickup, count(*) filter (where o.mode = 'delivery')::int as delivery
          from public.orders o where ${scope}`,
        sql<{ day: string; orders: number; revenue: number }[]>`
          select to_char(o.created_at at time zone 'Europe/Paris', 'YYYY-MM-DD') as day, count(*)::int as orders,
                 sum(o.total_cents - o.refunded_cents)::int as revenue
          from public.orders o where ${scope} group by 1 order by 1`,
        sql<{ restaurant_id: string; name: string; orders: number; revenue: number }[]>`
          select o.restaurant_id, r.name, count(*)::int as orders, sum(o.total_cents - o.refunded_cents)::int as revenue
          from public.orders o join public.restaurants r on r.id = o.restaurant_id where ${scope}
          group by 1, 2 order by revenue desc`,
      ]);
      const t = totals[0] ?? { revenue: 0, orders: 0, pickup: 0, delivery: 0 };
      return {
        revenueCents: t.revenue,
        orders: t.orders,
        averageBasketCents: t.orders > 0 ? Math.round(t.revenue / t.orders) : 0,
        byMode: { pickup: t.pickup, delivery: t.delivery },
        byDay: byDay.map((d) => ({ day: d.day, orders: d.orders, revenueCents: d.revenue })),
        byRestaurant: byRestaurant.map((r) => ({
          restaurantId: r.restaurant_id,
          name: r.name,
          orders: r.orders,
          revenueCents: r.revenue,
        })),
      };
    },

    async listCustomers(tenantId, search, limit) {
      const pattern = search ? `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
      const rows = await sql<
        {
          id: string;
          name: string;
          email: string | null;
          phone: string;
          marketing_consent: boolean;
          orders: number;
          spent: number;
          last_order_at: Date | null;
        }[]
      >`
        select c.id, c.name, c.email, c.phone, c.marketing_consent,
               count(o.id) filter (where ${revenue(sql)})::int as orders,
               coalesce(sum(o.total_cents - o.refunded_cents) filter (where ${revenue(sql)}), 0)::int as spent,
               max(o.created_at) as last_order_at
        from public.customers c left join public.orders o on o.customer_id = c.id
        where c.tenant_id = ${tenantId}
          ${pattern ? sql`and (c.name ilike ${pattern} or c.email ilike ${pattern} or c.phone ilike ${pattern})` : sql``}
        group by c.id order by last_order_at desc nulls last limit ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        marketingConsent: r.marketing_consent,
        orders: r.orders,
        spentCents: r.spent,
        lastOrderAt: r.last_order_at?.toISOString() ?? null,
      }));
    },

    async anonymizeCustomer(tenantId, customerId) {
      return sql.begin(async (tx) => {
        const r = await tx`
          update public.customers set name = 'Client supprimé', email = null,
            phone = '', marketing_consent = false, contact_key = ${`supprime:${customerId}`}
          where tenant_id = ${tenantId} and id = ${customerId}`;
        if (r.count !== 1) return false;
        await tx`update public.orders set delivery_address = case when delivery_address is null then null
                   else jsonb_build_object('label', 'Adresse supprimée', 'postalCode', delivery_address->>'postalCode',
                     'city', delivery_address->>'city', 'latitude', null, 'longitude', null, 'instructions', null) end
                 where tenant_id = ${tenantId} and customer_id = ${customerId}`;
        await tx`delete from public.order_push_tokens t using public.orders o
                 where t.order_id = o.id and o.tenant_id = ${tenantId} and o.customer_id = ${customerId}`;
        return true;
      });
    },

    async listTenants() {
      const rows = await sql<
        {
          id: string;
          name: string;
          subdomain: string;
          splash360_id: string;
          status: 'active' | 'suspended';
          application_fee_bps: number;
          application_fee_fixed_cents: number;
          restaurants: number;
          has_draft: boolean;
          owner_active: boolean;
          primary_color: string | null;
          logo_url: string | null;
        }[]
      >`
        select t.id, t.name, t.subdomain, t.splash360_id, t.status, t.application_fee_bps, t.application_fee_fixed_cents,
               (select count(*)::int from public.restaurants r where r.tenant_id = t.id) as restaurants,
               coalesce(th.draft is not null, false) as has_draft,
               exists (select 1 from public.staff_users s where s.tenant_id = t.id and s.role = 'tenant_admin'
                       and s.auth_user_id is not null and not s.disabled) as owner_active,
               th.primary_color, th.logo_url
        from public.tenants t left join public.tenant_theme th on th.tenant_id = t.id
        order by t.name`;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        subdomain: r.subdomain,
        splash360Id: r.splash360_id,
        status: r.status,
        applicationFeeBps: r.application_fee_bps,
        applicationFeeFixedCents: r.application_fee_fixed_cents,
        restaurants: r.restaurants,
        hasDraft: r.has_draft,
        ownerActive: r.owner_active,
        primaryColor: r.primary_color,
        logoUrl: r.logo_url,
      }));
    },

    async createTenant(input) {
      return sql.begin(async (tx) => {
        const [t] = await tx<{ id: string }[]>`
          insert into public.tenants (name, subdomain, splash360_id) values (${input.name}, ${input.subdomain}, ${input.splash360Id})
          returning id`;
        if (!t) throw new Error('Création impossible');
        await tx`insert into public.tenant_theme (tenant_id) values (${t.id})`;
        await tx`insert into public.staff_users (tenant_id, email, role) values (${t.id}, ${input.adminEmail.toLowerCase()}, 'tenant_admin')`;
        return { tenantId: t.id };
      });
    },

    async updateTenant(tenantId, input) {
      const r = await sql`
        update public.tenants set
          status = coalesce(${input.status ?? null}, status),
          application_fee_bps = coalesce(${input.applicationFeeBps ?? null}, application_fee_bps),
          application_fee_fixed_cents = coalesce(${input.applicationFeeFixedCents ?? null}, application_fee_fixed_cents)
        where id = ${tenantId}`;
      return r.count === 1;
    },

    async deleteTenant(tenantId) {
      return sql.begin(async (tx) => {
        const [t] = await tx<{ id: string; has_orders: boolean }[]>`
          select id, exists (select 1 from public.orders o where o.tenant_id = t.id) as has_orders
          from public.tenants t where id = ${tenantId} for update`;
        if (!t) return 'not_found' as const;
        if (t.has_orders) return 'has_orders' as const;
        await tx`delete from public.tenants where id = ${tenantId}`;
        return 'deleted' as const;
      });
    },
  };
}

type SqlLike = Queryable;

/** Version publiée du design (colonnes lues par l'application). */
async function upsertTheme(sql: SqlLike, tenantId: string, t: ThemeRecord): Promise<void> {
  await sql`insert into public.tenant_theme (tenant_id, primary_color, mode, logo_url, tagline,
              header_style, corner_style, uppercase_titles, pattern, loyalty_color)
            values (${tenantId}, ${t.primaryColor}, ${t.mode}, ${t.logoUrl}, ${t.tagline},
              ${t.style.header}, ${t.style.corners}, ${t.style.uppercaseTitles}, ${t.style.pattern},
              ${t.loyaltyColor})
            on conflict (tenant_id) do update set primary_color = excluded.primary_color, mode = excluded.mode,
              logo_url = excluded.logo_url, tagline = excluded.tagline,
              header_style = excluded.header_style, corner_style = excluded.corner_style,
              uppercase_titles = excluded.uppercase_titles, pattern = excluded.pattern,
              loyalty_color = excluded.loyalty_color, updated_at = now()`;
}

function toJson(t: ThemeRecord) {
  return {
    primaryColor: t.primaryColor,
    mode: t.mode,
    logoUrl: t.logoUrl,
    tagline: t.tagline,
    style: { ...t.style },
    loyaltyColor: t.loyaltyColor,
  };
}
