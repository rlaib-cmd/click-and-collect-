import { DEFAULT_STYLE } from '@splash360/theme';
import { randomUUID } from 'node:crypto';
import type {
  AdminStore,
  RestaurantSettingsRecord,
  StaffUser,
  TenantWithTheme,
} from '@splash360/db';
import type { StoredOrder } from './memory-ordering';

/** Version en mémoire de `AdminStore` pour les tests de routes (la version Postgres a ses propres tests). */
export function createMemoryAdminStore(input: {
  staff: (StaffUser & { authUserId?: string })[];
  tenants: TenantWithTheme[];
  orders: () => StoredOrder[];
  settings?: Record<string, RestaurantSettingsRecord>;
}) {
  type MemoryStaff = { -readonly [K in keyof StaffUser]: StaffUser[K] } & {
    authUserId?: string;
    disabled: boolean;
  };
  const staff: MemoryStaff[] = input.staff.map((s) => ({ ...s, disabled: false }));
  const audit: {
    tenantId: string | null;
    actorEmail: string;
    action: string;
    target: string | null;
    detail: unknown;
    at: string;
  }[] = [];
  const overrides: {
    tenantId: string;
    restaurantId: string;
    kind: 'category' | 'product';
    itemId: string;
    hidden: boolean;
    position: number | null;
  }[] = [];
  const drafts = new Map<string, { draft: unknown; updatedAt: string }>();
  const themes = new Map(
    input.tenants.map((t) => [
      t.id,
      t.theme ?? {
        primaryColor: '#1F6FEB',
        mode: 'light' as const,
        logoUrl: null,
        tagline: null,
        style: DEFAULT_STYLE,
        loyaltyColor: null,
      },
    ]),
  );
  const legal = new Map<string, string | null>();
  const settings = new Map(Object.entries(input.settings ?? {}));
  const paused = new Set<string>();

  const store: AdminStore = {
    resolveStaff(authUserId, email) {
      for (const s of staff)
        if (!s.authUserId && s.email === email.toLowerCase() && !s.disabled)
          s.authUserId = authUserId;
      return Promise.resolve(staff.filter((s) => s.authUserId === authUserId && !s.disabled));
    },
    listStaff: (tenantId) =>
      Promise.resolve(
        staff.filter((s) => s.tenantId === tenantId).map((s) => ({ ...s, pending: !s.authUserId })),
      ),
    updateStaffRole(tenantId, id, role, restaurantId) {
      const s = staff.find(
        (x) => x.tenantId === tenantId && x.id === id && x.role !== 'super_admin',
      );
      if (s) {
        s.role = role;
        s.restaurantId = restaurantId;
      }
      return Promise.resolve(Boolean(s));
    },
    inviteStaff(i) {
      if (staff.some((s) => s.email === i.email.toLowerCase() && s.tenantId === i.tenantId))
        return Promise.reject(new Error('doublon'));
      const s = {
        id: randomUUID(),
        email: i.email.toLowerCase(),
        name: i.name,
        role: i.role,
        tenantId: i.tenantId,
        restaurantId: i.restaurantId,
        disabled: false,
      };
      staff.push(s);
      return Promise.resolve(s);
    },
    setStaffDisabled(tenantId, id, disabled) {
      const s = staff.find((x) => x.tenantId === tenantId && x.id === id);
      if (s) s.disabled = disabled;
      return Promise.resolve(Boolean(s));
    },
    deleteStaff(tenantId, id) {
      const i = staff.findIndex(
        (x) => x.tenantId === tenantId && x.id === id && x.role !== 'super_admin',
      );
      if (i >= 0) staff.splice(i, 1);
      return Promise.resolve(i >= 0);
    },
    audit(e) {
      audit.push({
        tenantId: e.tenantId,
        actorEmail: e.actor.email,
        action: e.action,
        target: e.target ?? null,
        detail: e.detail ?? null,
        at: new Date().toISOString(),
      });
      return Promise.resolve();
    },
    listAudit: (tenantId, limit) =>
      Promise.resolve(
        audit
          .filter((a) => a.tenantId === tenantId)
          .reverse()
          .slice(0, limit),
      ),
    listOrders(tenantId, f) {
      return Promise.resolve(
        input
          .orders()
          .filter(
            (o) =>
              o.tenantId === tenantId &&
              (!f.restaurantId || o.restaurantId === f.restaurantId) &&
              (!f.statuses?.length || f.statuses.includes(o.status)),
          )
          .map((o) => ({
            id: o.id,
            number: o.number,
            restaurantId: o.restaurantId,
            status: o.status,
            mode: o.mode,
            customerName: o.customer.name,
            totalCents: o.totals.totalCents,
            estimatedAt: o.estimatedAt,
            createdAt: o.createdAt,
            itemCount: o.lines.reduce((n, l) => n + l.quantity, 0),
            paymentMethod: o.paymentMethod ?? 'online',
          })),
      );
    },
    setRestaurantStatus(_tenantId, restaurantId, status) {
      if (status === 'paused') paused.add(restaurantId);
      else paused.delete(restaurantId);
      return Promise.resolve(true);
    },
    getTheme: (tenantId) => Promise.resolve(themes.get(tenantId) ?? null),
    updateTheme(tenantId, t) {
      themes.set(tenantId, t);
      const tenant = input.tenants.find((x) => x.id === tenantId);
      if (tenant) Object.assign(tenant, { theme: t });
      return Promise.resolve();
    },
    getThemeDraft: (tenantId) => Promise.resolve(drafts.get(tenantId) ?? null),
    setThemeDraft(tenantId, draft) {
      if (draft)
        drafts.set(tenantId, {
          draft: structuredClone(draft),
          updatedAt: new Date().toISOString(),
        });
      else drafts.delete(tenantId);
      return Promise.resolve();
    },
    async publishTheme(tenantId, t) {
      themes.set(tenantId, t);
      const tenant = input.tenants.find((x) => x.id === tenantId);
      if (tenant) Object.assign(tenant, { theme: t });
      drafts.delete(tenantId);
      return Promise.resolve();
    },
    getLegalText: (tenantId) => Promise.resolve(legal.get(tenantId) ?? null),
    setLegalText(tenantId, text) {
      legal.set(tenantId, text);
      return Promise.resolve();
    },
    getSettings: (_tenantId, restaurantId) => Promise.resolve(settings.get(restaurantId) ?? null),
    saveSettings(_tenantId, restaurantId, s) {
      settings.set(restaurantId, s);
      return Promise.resolve();
    },
    listMenuOverrides: (tenantId, restaurantId) =>
      Promise.resolve(
        overrides.filter((o) => o.tenantId === tenantId && o.restaurantId === restaurantId),
      ),
    setMenuOverride(tenantId, restaurantId, o) {
      const i = overrides.findIndex(
        (x) => x.restaurantId === restaurantId && x.kind === o.kind && x.itemId === o.itemId,
      );
      if (i >= 0) overrides.splice(i, 1);
      overrides.push({ tenantId, restaurantId, ...o });
      return Promise.resolve();
    },
    dashboard(tenantId) {
      const paid = input
        .orders()
        .filter(
          (o) =>
            o.tenantId === tenantId &&
            !['pending_payment', 'payment_failed', 'cancelled'].includes(o.status),
        );
      const revenue = paid.reduce((s, o) => s + o.totals.totalCents - o.refundedCents, 0);
      return Promise.resolve({
        revenueCents: revenue,
        orders: paid.length,
        averageBasketCents: paid.length ? Math.round(revenue / paid.length) : 0,
        byMode: {
          pickup: paid.filter((o) => o.mode === 'pickup').length,
          delivery: paid.filter((o) => o.mode === 'delivery').length,
        },
        byDay: [],
        byRestaurant: [],
      });
    },
    listCustomers(tenantId) {
      const seen = new Map<
        string,
        {
          id: string;
          name: string;
          email: string | null;
          phone: string;
          marketingConsent: boolean;
          orders: number;
          spentCents: number;
          lastOrderAt: string | null;
        }
      >();
      for (const o of input.orders().filter((x) => x.tenantId === tenantId)) {
        const key = o.customer.email ?? o.customer.phone;
        const c = seen.get(key) ?? {
          id: randomUUID(),
          ...o.customer,
          orders: 0,
          spentCents: 0,
          lastOrderAt: null,
        };
        c.orders += 1;
        c.spentCents += o.totals.totalCents;
        c.lastOrderAt = o.createdAt;
        seen.set(key, c);
      }
      return Promise.resolve([...seen.values()]);
    },
    anonymizeCustomer: () => Promise.resolve(true),
    listTenants: () =>
      Promise.resolve(
        input.tenants.map((t) => ({
          id: t.id,
          name: t.name,
          subdomain: t.subdomain,
          splash360Id: `S360-${t.subdomain}`,
          status: t.status,
          applicationFeeBps: t.applicationFee.bps,
          applicationFeeFixedCents: t.applicationFee.fixedCents,
          restaurants: 1,
        })),
      ),
    createTenant(i) {
      if (input.tenants.some((t) => t.subdomain === i.subdomain))
        return Promise.reject(new Error('doublon'));
      const id = randomUUID();
      input.tenants.push({
        id,
        name: i.name,
        subdomain: i.subdomain,
        splash360Id: i.splash360Id,
        status: 'active',
        applicationFee: { bps: 0, fixedCents: 0 },
        theme: null,
      });
      staff.push({
        id: randomUUID(),
        email: i.adminEmail.toLowerCase(),
        name: null,
        role: 'tenant_admin',
        tenantId: id,
        restaurantId: null,
        disabled: false,
      });
      return Promise.resolve({ tenantId: id });
    },
    updateTenant(tenantId, i) {
      const t = input.tenants.find((x) => x.id === tenantId);
      if (!t) return Promise.resolve(false);
      if (i.status) Object.assign(t, { status: i.status });
      return Promise.resolve(true);
    },
    deleteTenant(tenantId) {
      const i = input.tenants.findIndex((x) => x.id === tenantId);
      if (i < 0) return Promise.resolve('not_found' as const);
      if (input.orders().some((o) => o.tenantId === tenantId))
        return Promise.resolve('has_orders' as const);
      input.tenants.splice(i, 1);
      return Promise.resolve('deleted' as const);
    },
  };
  return { store, audit, paused, overrides };
}
