import {
  adminOrderDetailSchema,
  clubMemberSchema,
  meSchema,
  menuSchema,
  placedOrderSchema,
  tenantConfigSchema,
} from '@splash360/contracts';
import { createDemoLoyaltyProvider, createMemoryDemoLoyaltyStore } from '@splash360/api-loyalty';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BELLA_ID,
  BELLA_RESTO,
  GREEN_ID,
  sessionToken,
  STAFF_IDS,
  testSetup,
} from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };

async function as(email: string, tenantId?: string) {
  return {
    Authorization: `Bearer ${await sessionToken(email)}`,
    ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    ...json,
  };
}

async function paidOrder(setup: ReturnType<typeof testSetup>) {
  const res = await setup.app.request('/v1/tenants/bella/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      restaurantId: BELLA_RESTO,
      mode: 'pickup',
      address: null,
      requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
      lines: [{ productId: 'p-tiramisu', quantity: 2, optionIds: [] }],
      customer: {
        name: 'Camille Martin',
        email: 'camille@example.fr',
        phone: '0612345678',
        marketingConsent: false,
      },
      idempotencyKey: 'cle-admin-00000000001',
      acceptedTerms: true,
    }),
  });
  const order = placedOrderSchema.parse(await res.json());
  await setup.app.request(`/v1/tenants/bella/orders/${order.orderId}/payment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${order.accessToken}` },
  });
  await setup.app.request('/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'whsec_test' },
    body: JSON.stringify({
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1300,
      currency: 'eur',
    }),
  });
  return order;
}

describe('authentification du back-office', () => {
  it('refuse sans jeton, avec un jeton falsifié ou expiré, et un compte inconnu', async () => {
    const { app } = testSetup();
    expect((await app.request('/v1/admin/me')).status).toBe(401);
    const forged = await sessionToken(
      'gerant@bella.test',
      'un-autre-secret-de-signature-0123456789',
    );
    expect(
      (await app.request('/v1/admin/me', { headers: { Authorization: `Bearer ${forged}` } }))
        .status,
    ).toBe(401);
    const expired = await sessionToken('gerant@bella.test', undefined, '-1m');
    expect(
      (await app.request('/v1/admin/me', { headers: { Authorization: `Bearer ${expired}` } }))
        .status,
    ).toBe(401);
    expect(
      (await app.request('/v1/admin/me', { headers: await as('inconnu@example.fr') })).status,
    ).toBe(403);
  });

  it('donne au gérant son enseigne, quelle que soit l’enseigne demandée', async () => {
    const { app } = testSetup();
    const me = meSchema.parse(
      await (
        await app.request('/v1/admin/me', { headers: await as('gerant@bella.test', GREEN_ID) })
      ).json(),
    );
    expect(me).toMatchObject({ role: 'tenant_admin', tenant: { id: BELLA_ID } });
  });

  it('laisse le super-administrateur se connecter en tant qu’une enseigne, et journalise', async () => {
    const setup = testSetup();
    expect(
      (await setup.app.request('/v1/admin/orders', { headers: await as('admin@splash360.test') }))
        .status,
    ).toBe(400);
    const headers = await as('admin@splash360.test', BELLA_ID);
    expect(
      meSchema.parse(await (await setup.app.request('/v1/admin/me', { headers })).json()).tenant
        ?.name,
    ).toBe('Pizzeria Bella');
    await setup.app.request('/v1/admin/legal', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ text: 'CGV' }),
    });
    expect(setup.admin.audit.at(-1)).toMatchObject({
      tenantId: BELLA_ID,
      actorEmail: 'admin@splash360.test',
      action: 'legal.update',
    });
  });
});

describe('commandes', () => {
  it('liste, détaille et fait avancer une commande ; le client est notifié', async () => {
    const setup = testSetup();
    const order = await paidOrder(setup);
    const headers = await as('equipe@bella.test');
    const list = (await (
      await setup.app.request('/v1/admin/orders?status=paid', { headers })
    ).json()) as { orders: { id: string }[] };
    expect(list.orders.map((o) => o.id)).toEqual([order.orderId]);
    const res = await setup.app.request(`/v1/admin/orders/${order.orderId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'preparing' }),
    });
    expect(res.status).toBe(200);
    const back = await setup.app.request(`/v1/admin/orders/${order.orderId}/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'accepted' }),
    });
    expect(back.status).toBe(409);
    const detail = adminOrderDetailSchema.parse(
      await (await setup.app.request(`/v1/admin/orders/${order.orderId}`, { headers })).json(),
    );
    expect(detail.history.at(-1)).toMatchObject({
      status: 'preparing',
      actor: `staff:${STAFF_IDS.bellaStaff}`,
    });
    expect(setup.notifications.pushes.length + setup.notifications.emails.length).toBeGreaterThan(
      0,
    );
  });

  it('réserve le remboursement aux administrateurs, journalisé', async () => {
    const setup = testSetup();
    const order = await paidOrder(setup);
    const body = JSON.stringify({ amountCents: 300, requestId: 'demande-1' });
    expect(
      (
        await setup.app.request(`/v1/admin/orders/${order.orderId}/refund`, {
          method: 'POST',
          headers: await as('equipe@bella.test'),
          body,
        })
      ).status,
    ).toBe(403);
    const ok = await setup.app.request(`/v1/admin/orders/${order.orderId}/refund`, {
      method: 'POST',
      headers: await as('gerant@bella.test'),
      body,
    });
    expect(await ok.json()).toEqual({ ok: true, refundedCents: 300, fullyRefunded: false });
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'order.refund',
      detail: { amountCents: 300 },
    });
  });

  it("ne montre pas la commande d'une enseigne à une autre", async () => {
    const setup = testSetup();
    const order = await paidOrder(setup);
    const res = await setup.app.request(`/v1/admin/orders/${order.orderId}`, {
      headers: await as('gerant@greenbowl.test'),
    });
    expect(res.status).toBe(404);
  });
});

describe('design, carte et réglages', () => {
  it('le design modifié est servi à l’application au prochain démarrage', async () => {
    const setup = testSetup();
    const theme = {
      primaryColor: '#0B6E4F',
      mode: 'dark',
      logoUrl: 'https://cdn.example.fr/logo.png',
      tagline: 'Nouveau slogan',
      style: { header: 'brand', corners: 'square', uppercaseTitles: true, pattern: 'checker' },
      loyaltyColor: '#F2B705',
    };
    expect(
      (
        await setup.app.request('/v1/admin/theme', {
          method: 'PUT',
          headers: await as('gerant@bella.test'),
          body: JSON.stringify(theme),
        })
      ).status,
    ).toBe(204);
    const config = tenantConfigSchema.parse(
      await (await setup.app.request('/v1/tenants/bella/config')).json(),
    );
    expect(config.theme).toEqual(theme);
    expect(
      (
        await setup.app.request('/v1/admin/theme', {
          method: 'PUT',
          headers: await as('equipe@bella.test'),
          body: JSON.stringify(theme),
        })
      ).status,
    ).toBe(403);
  });

  it('un produit masqué disparaît de la carte et ne peut plus être commandé', async () => {
    const setup = testSetup();
    await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/menu/overrides`, {
      method: 'PUT',
      headers: await as('gerant@bella.test'),
      body: JSON.stringify({
        overrides: [{ kind: 'product', itemId: 'p-tiramisu', hidden: true, position: null }],
      }),
    });
    const menu = menuSchema.parse(
      await (await setup.app.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu`)).json(),
    );
    expect(menu.categories.flatMap((c) => c.products.map((p) => p.id))).not.toContain('p-tiramisu');
    const quote = await setup.app.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/quote`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        mode: 'pickup',
        address: null,
        requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
        lines: [{ productId: 'p-tiramisu', quantity: 1, optionIds: [] }],
      }),
    });
    expect(quote.status).toBe(422);
    const admin = (await (
      await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/menu`, {
        headers: await as('gerant@bella.test'),
      })
    ).json()) as { warnings: unknown[]; overrides: unknown[] };
    expect(admin.overrides).toHaveLength(1);
    expect(admin.warnings.length).toBeGreaterThan(0); // produits sans photo
  });

  it('valide les réglages avant de les enregistrer', async () => {
    const setup = testSetup();
    const headers = await as('gerant@bella.test');
    const current = await (
      await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/settings`, { headers })
    ).json();
    const bad = {
      ...(current as object),
      openingHours: [{ isoWeekday: 2, opens: '14:00', closes: '12:00' }],
    };
    expect(
      (
        await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/settings`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(bad),
        })
      ).status,
    ).toBe(400);
    const none = { ...(current as object), pickupEnabled: false, deliveryEnabled: false };
    expect(
      (
        await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/settings`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(none),
        })
      ).status,
    ).toBe(400);
    const good = { ...(current as object), prepMinutes: 30 };
    expect(
      (
        await setup.app.request(`/v1/admin/restaurants/${BELLA_RESTO}/settings`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(good),
        })
      ).status,
    ).toBe(204);
  });
});

describe('clients, équipe et enseignes', () => {
  it('exporte les clients en CSV en neutralisant les formules', async () => {
    const setup = testSetup();
    await paidOrder(setup);
    const first = setup.backend.orders[0];
    if (first)
      Object.assign(first, { customer: { ...first.customer, name: '=HYPERLINK("http://x")' } });
    const res = await setup.app.request('/v1/admin/customers/export', {
      headers: await as('gerant@bella.test'),
    });
    const csv = await res.text();
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(setup.admin.audit.at(-1)?.action).toBe('customers.export');
  });

  it('invite un équipier rattaché à un restaurant', async () => {
    const setup = testSetup();
    const headers = await as('gerant@bella.test');
    expect(
      (
        await setup.app.request('/v1/admin/staff', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email: 'new@bella.test',
            name: null,
            role: 'staff',
            restaurantId: null,
          }),
        })
      ).status,
    ).toBe(400);
    const ok = await setup.app.request('/v1/admin/staff', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'New@Bella.test',
        name: 'Nouveau',
        role: 'staff',
        restaurantId: BELLA_RESTO,
      }),
    });
    expect(ok.status).toBe(201);
    expect(
      (
        await setup.app.request('/v1/admin/staff', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            email: 'new@bella.test',
            name: null,
            role: 'staff',
            restaurantId: BELLA_RESTO,
          }),
        })
      ).status,
    ).toBe(409);
  });

  it('réserve la création d’enseigne au super-administrateur', async () => {
    const setup = testSetup();
    const body = JSON.stringify({
      name: 'Le Bistrot',
      subdomain: 'lebistrot',
      splash360Id: 'S360-BISTROT',
      adminEmail: 'patron@bistrot.fr',
    });
    expect(
      (
        await setup.app.request('/v1/admin/tenants', {
          method: 'POST',
          headers: await as('gerant@bella.test'),
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await setup.app.request('/v1/admin/tenants', {
          method: 'POST',
          headers: await as('admin@splash360.test'),
          body,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await setup.app.request('/v1/admin/tenants', {
          method: 'POST',
          headers: await as('admin@splash360.test'),
          body,
        })
      ).status,
    ).toBe(409);
  });
});

describe('administration de la plateforme (lot 9)', () => {
  it('supprime une enseigne sans commande, refuse si elle a des commandes, réservé au super-administrateur', async () => {
    const setup = testSetup();
    await paidOrder(setup);
    const del = async (id: string, email = 'admin@splash360.test') =>
      setup.app.request(`/v1/admin/tenants/${id}`, { method: 'DELETE', headers: await as(email) });
    expect((await del(GREEN_ID, 'gerant@bella.test')).status).toBe(403);
    const refused = await del(BELLA_ID);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('bloquez-la');
    expect((await del(GREEN_ID)).status).toBe(204);
    expect(setup.admin.audit.at(-1)).toMatchObject({ action: 'tenant.delete', tenantId: null });
    expect((await del(GREEN_ID)).status).toBe(404);
    expect((await setup.app.request('/v1/tenants/greenbowl/config')).status).toBe(404);
  });

  it('bloque puis débloque l’application d’une enseigne', async () => {
    const setup = testSetup();
    const patch = async (status: string) =>
      setup.app.request(`/v1/admin/tenants/${BELLA_ID}`, {
        method: 'PATCH',
        headers: await as('admin@splash360.test'),
        body: JSON.stringify({ status }),
      });
    expect((await patch('suspended')).status).toBe(204);
    expect((await setup.app.request('/v1/tenants/bella/config')).status).toBe(403);
    expect((await patch('active')).status).toBe(204);
    expect((await setup.app.request('/v1/tenants/bella/config')).status).toBe(200);
  });

  it('supprime un compte de l’équipe, jamais le sien ni celui d’une autre enseigne', async () => {
    const setup = testSetup();
    const headers = await as('gerant@bella.test');
    const del = (id: string) =>
      setup.app.request(`/v1/admin/staff/${id}`, { method: 'DELETE', headers });
    expect((await del(STAFF_IDS.bellaAdmin)).status).toBe(409);
    expect((await del(STAFF_IDS.greenAdmin)).status).toBe(404);
    expect((await del(STAFF_IDS.superAdmin)).status).toBe(404);
    expect((await del(STAFF_IDS.bellaStaff)).status).toBe(204);
    expect(setup.admin.audit.at(-1)?.action).toBe('staff.delete');
    expect((await del(STAFF_IDS.bellaStaff)).status).toBe(404);
  });

  it('administre le club : liste, corrige les points sans solde négatif, supprime un membre', async () => {
    let n = 0;
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => `carte-${++n}-0000-0000-0000`,
      new Map([
        [
          'S360-DEMO-BELLA',
          { name: 'Club Bella', pointsPerEuro: 10, welcomePoints: 100, rewards: [] },
        ],
      ]),
    );
    const setup = testSetup({ loyalty });
    await setup.app.request('/v1/tenants/bella/loyalty/join', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'Léa',
        email: 'lea@example.fr',
        phone: null,
        acceptedTerms: true,
      }),
    });
    const headers = await as('gerant@bella.test');
    const list = async (q = '') =>
      z
        .object({ members: z.array(clubMemberSchema) })
        .parse(await (await setup.app.request(`/v1/admin/loyalty/members${q}`, { headers })).json())
        .members;
    const [lea] = await list('?q=lea');
    expect(lea).toMatchObject({ name: 'Léa', points: 100 });
    const id = lea?.id ?? '';
    const adjust = (delta: number, reason = 'Geste commercial') =>
      setup.app.request(`/v1/admin/loyalty/members/${id}/adjust`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ delta, reason }),
      });
    expect((await adjust(0)).status).toBe(400);
    expect(await (await adjust(50)).json()).toEqual({ points: 150 });
    expect((await adjust(-151)).status).toBe(409);
    expect(setup.admin.audit.at(-1)).toMatchObject({ action: 'loyalty.adjust', target: id });
    expect(
      (
        await setup.app.request(`/v1/admin/loyalty/members/${id}`, {
          headers: await as('equipe@bella.test'),
          method: 'DELETE',
        })
      ).status,
    ).toBe(403);
    expect(
      (await setup.app.request(`/v1/admin/loyalty/members/${id}`, { headers, method: 'DELETE' }))
        .status,
    ).toBe(204);
    expect(await list()).toEqual([]);
    // Enseigne sans club : rien à administrer.
    expect(
      (
        await setup.app.request('/v1/admin/loyalty/members', {
          headers: await as('gerant@greenbowl.test'),
        })
      ).status,
    ).toBe(404);
  });
});
