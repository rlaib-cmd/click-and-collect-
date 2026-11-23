import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPostgresAdminStore } from './admin';
import { createSql } from './client';
import { createPostgresOrderingStore } from './ordering';
import { createPostgresRestaurantStore } from './restaurants';
import { createPostgresTenantStore } from './tenants';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';

describe.skipIf(!url)('AdminStore Postgres', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const admin = createPostgresAdminStore(sql);
  const restaurants = createPostgresRestaurantStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.tenants where subdomain = ${`test-${run}`}`;
    await sql.end();
  });

  it('rattache un compte à sa première connexion et ne connaît pas un inconnu', async () => {
    const authId = randomUUID();
    const [staff] = await admin.resolveStaff(authId, 'GERANT@bella.test');
    expect(staff).toMatchObject({ role: 'tenant_admin', tenantId: BELLA });
    expect(await admin.resolveStaff(randomUUID(), 'gerant@bella.test')).toEqual([]); // déjà rattaché à un autre compte
    expect(await admin.resolveStaff(randomUUID(), 'inconnu@example.fr')).toEqual([]);
    await sql`update public.staff_users set auth_user_id = null where email = 'gerant@bella.test'`;
  });

  it('enregistre et relit les réglages ; archive une zone utilisée', async () => {
    const [r] = await restaurants.listByTenant(BELLA);
    const id = r?.id ?? '';
    const before = await admin.getSettings(BELLA, id);
    expect(before?.openingHours).toContainEqual({ isoWeekday: 2, opens: '11:30', closes: '14:30' });
    if (!before) return;
    await admin.saveSettings(BELLA, id, {
      ...before,
      prepMinutes: 25,
      openingHours: [{ isoWeekday: 3, opens: '12:00', closes: '14:00' }],
      closures: [{ day: '2030-12-25', reason: 'Noël' }],
      zones: [
        {
          name: 'Paris 11',
          kind: 'postal_codes',
          radiusMeters: null,
          postalCodes: ['75011'],
          feeCents: 250,
        },
      ],
    });
    const after = await admin.getSettings(BELLA, id);
    expect(after).toMatchObject({
      prepMinutes: 25,
      openingHours: [{ isoWeekday: 3, opens: '12:00', closes: '14:00' }],
    });
    expect(after?.closures).toEqual([{ day: '2030-12-25', reason: 'Noël' }]);
    expect(after?.zones.map((z) => z.name)).toEqual(['Paris 11']);
    expect(await admin.getSettings(GREEN, id)).toBeNull();
    await admin.saveSettings(BELLA, id, before);
  });

  it('calcule le tableau de bord et cloisonne la liste des commandes', async () => {
    const stats = await admin.dashboard(BELLA, new Date('2000-01-01'), new Date('2100-01-01'));
    expect(stats.orders).toBe(stats.byMode.pickup + stats.byMode.delivery);
    expect(stats.averageBasketCents).toBe(
      stats.orders ? Math.round(stats.revenueCents / stats.orders) : 0,
    );
    const greenOrders = await admin.listOrders(GREEN, { limit: 100 });
    const bellaOrders = await admin.listOrders(BELLA, { limit: 100 });
    expect(greenOrders.some((o) => bellaOrders.some((b) => b.id === o.id))).toBe(false);
  });

  it('anonymise un client sans supprimer ses commandes', async () => {
    const [r] = await restaurants.listByTenant(BELLA);
    const ordering = createPostgresOrderingStore(sql);
    const email = `rgpd-${run}@example.fr`;
    await ordering.createOrder({
      id: randomUUID(),
      tenantId: BELLA,
      restaurantId: r?.id ?? '',
      customer: { name: 'À effacer', email, phone: '0611111111', marketingConsent: true },
      mode: 'pickup',
      requestedSlot: null,
      estimatedAt: new Date().toISOString(),
      deliveryAddress: null,
      deliveryZoneId: null,
      lines: [],
      totals: {
        subtotalCents: 0 as never,
        deliveryFeeCents: 0 as never,
        serviceFeeCents: 0 as never,
        discountCents: 0 as never,
        promoDiscountCents: 0 as never,
        totalCents: 0 as never,
      },
      idempotencyKey: `rgpd-${run}`,
      applicationFeeCents: 0,
      accessTokenHash: 'x',
      maxOrdersPerSlot: null,
    });
    const [c] = await admin.listCustomers(BELLA, email, 10);
    expect(c).toMatchObject({ name: 'À effacer', marketingConsent: true });
    expect(await admin.anonymizeCustomer(GREEN, c?.id ?? '')).toBe(false);
    expect(await admin.anonymizeCustomer(BELLA, c?.id ?? '')).toBe(true);
    expect(await admin.listCustomers(BELLA, email, 10)).toEqual([]);
    const [o] = await sql<
      { n: number }[]
    >`select count(*)::int as n from public.orders where idempotency_key = ${`rgpd-${run}`}`;
    expect(o?.n).toBe(1);
    await sql`delete from public.orders where idempotency_key = ${`rgpd-${run}`}`;
  });

  it('crée une enseigne avec son thème et son premier administrateur', async () => {
    const { tenantId } = await admin.createTenant({
      name: 'Test',
      subdomain: `test-${run}`,
      splash360Id: `T-${run}`,
      adminEmail: `Admin-${run}@Example.fr`,
    });
    expect(await admin.getTheme(tenantId)).toMatchObject({
      primaryColor: '#1F6FEB',
      loyaltyColor: null,
      style: { header: 'plain', corners: 'rounded', uppercaseTitles: false, pattern: 'none' },
    });
    const style = {
      header: 'brand',
      corners: 'pill',
      uppercaseTitles: true,
      pattern: 'checker',
    } as const;
    await admin.updateTheme(tenantId, {
      primaryColor: '#CF2028',
      mode: 'light',
      logoUrl: null,
      tagline: null,
      style,
      loyaltyColor: '#111111',
    });
    expect(await admin.getTheme(tenantId)).toMatchObject({
      primaryColor: '#CF2028',
      style,
      loyaltyColor: '#111111',
    });
    const stored = await createPostgresTenantStore(sql).findById(tenantId);
    expect(stored?.theme?.style).toEqual(style);

    // Studio design (lot 12) : brouillon séparé de la version publiée, puis publication.
    expect(await admin.getThemeDraft(tenantId)).toBeNull();
    const draft = {
      primaryColor: '#1D4ED8',
      mode: 'dark' as const,
      logoUrl: 'https://exemple.fr/logo.png',
      tagline: 'Brouillon',
      style,
      loyaltyColor: null,
    };
    await admin.setThemeDraft(tenantId, draft);
    expect((await admin.getThemeDraft(tenantId))?.draft).toEqual(draft);
    expect((await admin.getTheme(tenantId))?.primaryColor).toBe('#CF2028');
    await admin.publishTheme(tenantId, draft);
    expect(await admin.getThemeDraft(tenantId)).toBeNull();
    expect(await admin.getTheme(tenantId)).toMatchObject({ primaryColor: '#1D4ED8', mode: 'dark' });
    await admin.updateTheme(tenantId, {
      ...draft,
      primaryColor: '#CF2028',
      mode: 'light',
      loyaltyColor: '#111111',
      logoUrl: null,
      tagline: null,
    });
    expect(stored?.theme?.loyaltyColor).toBe('#111111');
    expect((await admin.listStaff(tenantId))[0]).toMatchObject({
      role: 'tenant_admin',
      email: `admin-${run}@example.fr`,
    });
    expect(
      await admin.updateTenant(tenantId, { status: 'suspended', applicationFeeBps: 150 }),
    ).toBe(true);
    expect((await admin.listTenants()).find((t) => t.id === tenantId)).toMatchObject({
      status: 'suspended',
      applicationFeeBps: 150,
    });
  });

  it('supprime un équipier et une enseigne sans commande ; garde une enseigne qui a des commandes', async () => {
    const { tenantId } = await admin.createTenant({
      name: 'À supprimer',
      subdomain: `del-${run}`,
      splash360Id: `S360-DEL-${run}`,
      adminEmail: `del-${run}@example.fr`,
    });
    const [first] = await admin.listStaff(tenantId);
    expect(await admin.deleteStaff(BELLA, first?.id ?? '')).toBe(false);
    expect(await admin.deleteStaff(tenantId, first?.id ?? '')).toBe(true);
    expect(await admin.listStaff(tenantId)).toEqual([]);
    expect(await admin.deleteTenant(tenantId)).toBe('deleted');
    expect(await admin.deleteTenant(tenantId)).toBe('not_found');
    const [withOrders] = await sql<
      { tenant_id: string }[]
    >`select tenant_id from public.orders limit 1`;
    if (withOrders) expect(await admin.deleteTenant(withOrders.tenant_id)).toBe('has_orders');
  });
});
