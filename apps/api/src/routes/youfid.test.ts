import { createMemoryYoufidStore } from '@splash360/api-loyalty';
import { createFakeYoufid, FAKE_PIN } from '@splash360/api-loyalty/testing';
import {
  loyaltyMemberSchema,
  loyaltyProgramSchema,
  loyaltySessionSchema,
  placedOrderSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { createMemoryOtpStore, createMemoryTenantStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createOtpDeps, type SmsSender } from '../loyalty/otp';
import { configureLoyalty } from '../loyalty/youfid';
import { BELLA_ID, BELLA_RESTO, GREEN_ID, NOW, sessionToken, testSetup } from '../test-fixtures';

/** Lot 21 (ADR 0026) : parcours complet avec un faux serveur YouFID (aucun appel réel). */
function setup() {
  const fake = createFakeYoufid({ now: Date.now });
  const store = createMemoryYoufidStore();
  const logs: string[] = [];
  let n = 0;
  const { loyalty, youfid } = configureLoyalty({
    fallback: null,
    accountsJson: JSON.stringify({ bella: { login: 'marchand', password: 'secret-de-test' } }),
    baseUrl: undefined,
    deviceId: undefined,
    environment: 'recette',
    store,
    tenants: createMemoryTenantStore([
      {
        id: BELLA_ID,
        name: 'Pizzeria Bella',
        subdomain: 'bella',
        splash360Id: 'S360-DEMO-BELLA',
        status: 'active',
        applicationFee: { bps: 0, fixedCents: 0 },
        theme: null,
      },
    ]),
    random: () => `op-${String(++n)}`,
    log: (m, d) => logs.push(`${m} ${JSON.stringify(d ?? {})}`),
    fetch: fake.fetch,
  });
  const sent: string[] = [];
  const sms: SmsSender = {
    configured: true,
    send(_to, _sender, text) {
      sent.push(text);
      return Promise.resolve();
    },
  };
  const otp = createOtpDeps({
    store: createMemoryOtpStore(() => NOW),
    sms,
    notifier: { email: () => Promise.resolve() },
    emailConfigured: false,
    baseSecret: 'secret-de-test-0123456789abcdefghij',
    debugEcho: false,
    environment: 'recette',
    randomBytes: () => new Uint8Array([0, 1, 7, 64]),
    log: () => undefined,
    now: () => NOW,
  });
  const s = testSetup({
    ...(loyalty ? { loyalty } : {}),
    youfid,
    loyaltyLedger: store,
    otp,
    loyaltyDemoLogin: false,
  });
  const code = () => /^(\d{6})/.exec(sent.at(-1) ?? '')?.[1] ?? '';
  return { ...s, fake, store, logs, code };
}

const base = '/v1/tenants/bella';
const post = (s: ReturnType<typeof setup>, path: string, body: unknown, headers = {}) =>
  s.app.request(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function admin(
  s: ReturnType<typeof setup>,
  path: string,
  init: { method?: string; body?: unknown; email?: string } = {},
) {
  return s.app.request(`/v1/admin${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await sessionToken(init.email ?? 'gerant@bella.test')}`,
      'X-Tenant-Id': BELLA_ID,
      'Content-Type': 'application/json',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function signUp(s: ReturnType<typeof setup>, phone = '06 12 34 56 78') {
  await post(s, '/loyalty/otp/start', { channel: 'sms', identifier: phone });
  const res = await post(s, '/loyalty/otp/verify', {
    channel: 'sms',
    identifier: phone,
    code: s.code(),
    name: 'Sam',
    acceptedTerms: true,
  });
  expect(res.status).toBe(201);
  return loyaltySessionSchema.parse(await res.json());
}

const me = async (s: ReturnType<typeof setup>, token: string) =>
  loyaltyMemberSchema.parse(
    await (
      await s.app.request(`${base}/loyalty/me`, { headers: { Authorization: `Bearer ${token}` } })
    ).json(),
  );

describe('fidélité YouFID dans l’application (lot 21)', () => {
  it('publie le programme YouFID avec les réglages de l’enseigne', async () => {
    const s = setup();
    const program = loyaltyProgramSchema.parse(
      await (await s.app.request(`${base}/loyalty/program`)).json(),
    );
    expect(program).toMatchObject({
      enabled: true,
      name: 'Club Test',
      pointsPerEuro: 10,
      welcomePoints: 100,
      otp: true,
    });
    expect(program.enabled && program.rewards.map((r) => [r.id, r.costPoints])).toEqual([
      ['11', 300],
      ['12', 500],
    ]);
  });

  it('inscription par SMS : compte YouFID, QR code de la carte VIP, bienvenue, historique « app »', async () => {
    const s = setup();
    const session = await signUp(s);
    const yf = s.fake.customers.find((c) => c.phone === '0612345678');
    expect(yf?.prenom).toBe('Sam');
    expect(session.member).toMatchObject({
      name: 'Sam',
      phone: '+33612345678',
      points: 100,
      cardCode: yf?.qrCode,
      historyScope: 'app',
    });
    expect(session.memberToken).toMatch(/^m2\.\d+\./);
    const member = await me(s, session.memberToken);
    expect(member.history.map((h) => [h.kind, h.points])).toEqual([['welcome', 100]]);
    expect(JSON.stringify(member)).not.toContain(FAKE_PIN);
    // Reconnexion par le même mobile : même compte, ni nouveau client ni nouveau bonus.
    const tenant = { id: BELLA_ID, splash360Id: 'S360-DEMO-BELLA' };
    const found = await s.deps.loyalty?.findByPhone(tenant, '+33612345678');
    expect(found?.cardCode).toBe(yf?.qrCode);
    const again = await s.deps.loyalty?.join(tenant, {
      name: 'Membre',
      email: null,
      phone: '+33612345678',
    });
    expect(again).toMatchObject({ created: false, member: { points: 100 } });
    expect(s.fake.customers).toHaveLength(1);
  });

  it('inscription par e-mail seul : refusée avec un message clair', async () => {
    const s = setup();
    const joined = await s.deps.loyalty
      ?.join(
        { id: BELLA_ID, splash360Id: 'S360-DEMO-BELLA' },
        {
          name: 'X',
          email: 'x@example.fr',
          phone: null,
        },
      )
      .catch((e: unknown) => (e as Error).name);
    expect(joined).toBe('LoyaltyUnsupportedError');
  });

  it('commande payée : cadeau consommé et points gagnés chez YouFID, une seule fois', async () => {
    const s = setup();
    const { memberToken } = await signUp(s);
    await s.deps.admin.setRewardCategories(BELLA_ID, '11', ['cat-desserts']);
    // +250 par le back-office (crédit forcé) : 350 points, assez pour le cadeau à 300.
    const usrId = String(s.fake.customers[0]?.usrId);
    const adjust = await admin(s, `/loyalty/members/${usrId}/adjust`, {
      method: 'POST',
      body: { delta: 250, reason: 'Geste commercial' },
    });
    expect(adjust.status).toBe(200);
    const request: PlaceOrderRequest = {
      restaurantId: BELLA_RESTO,
      mode: 'pickup',
      address: null,
      requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
      lines: [
        { productId: 'p-margherita', quantity: 1, optionIds: ['opt-normale'] },
        { productId: 'p-tiramisu', quantity: 1, optionIds: [] },
      ],
      customer: {
        name: 'Sam',
        email: 'sam@example.fr',
        phone: '0612345678',
        marketingConsent: false,
      },
      idempotencyKey: 'cle-youfid-000000001',
      acceptedTerms: true,
      loyalty: { memberToken, rewardId: '11' },
    };
    const res = await post(s, '/orders', request);
    expect(res.status).toBe(201);
    const placed = placedOrderSchema.parse(await res.json());
    expect(placed.totals).toMatchObject({ discountCents: 650, totalCents: 1050 });
    await s.app.request(`${base}/orders/${placed.orderId}/payment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${placed.accessToken}` },
    });
    const paid = {
      type: 'payment_succeeded',
      paymentIntentId: 'pi_fake_1',
      amountCents: 1050,
      currency: 'eur',
    };
    for (let i = 0; i < 2; i += 1) {
      await s.app.request('/v1/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'whsec_test' },
        body: JSON.stringify(paid),
      });
    }
    const after = await me(s, memberToken);
    // 100 + 250 − 300 + 105 (10,50 € envoyés à YouFID).
    expect(after.points).toBe(155);
    expect(after.history.map((h) => h.kind)).toEqual(['earn', 'redeem', 'adjust', 'welcome']);
    expect(s.fake.calls.filter((c) => c.route === 'transformToPresent')).toHaveLength(1);
    expect(s.fake.calls.filter((c) => c.body.amount === 10.5)).toHaveLength(1);
    expect(s.backend.orders[0]?.loyaltySettled).toBe(true);
  });
});

describe('fidélité YouFID au back-office (lot 21)', () => {
  it('recherche des membres, réglages, retrait refusé, opérations à vérifier', async () => {
    const s = setup();
    const { member } = await signUp(s);
    const usrId = String(s.fake.customers[0]?.usrId);
    const list = (await (await admin(s, '/loyalty/members?q=0612345678')).json()) as {
      members: { id: string; points: number; cardCode: string }[];
    };
    expect(list.members).toEqual([
      expect.objectContaining({ id: usrId, points: 100, cardCode: member.cardCode }),
    ]);

    expect(await (await admin(s, '/loyalty/settings')).json()).toEqual({
      pointsPerEuro: 10,
      welcomePoints: 100,
      source: 'youfid',
    });
    const put = await admin(s, '/loyalty/settings', {
      method: 'PUT',
      body: { pointsPerEuro: 5, welcomePoints: 50 },
    });
    expect(put.status).toBe(204);
    expect(await s.store.getProgramSettings(BELLA_ID)).toEqual({
      pointsPerEuro: 5,
      welcomePoints: 50,
    });

    const negative = await admin(s, `/loyalty/members/${usrId}/adjust`, {
      method: 'POST',
      body: { delta: -20, reason: 'Retrait' },
    });
    expect(negative.status).toBe(400);
    expect(JSON.stringify(await negative.json())).toContain('non pris en charge par YouFID');

    s.fake.state.maxScansReached = true;
    const limited = await admin(s, `/loyalty/members/${usrId}/adjust`, {
      method: 'POST',
      body: { delta: 20, reason: 'Bonus' },
    });
    expect(limited.status).toBe(409);
    s.fake.state.maxScansReached = false;

    s.fake.dropResponse('marchandCheckScanUser');
    const lost = await admin(s, `/loyalty/members/${usrId}/adjust`, {
      method: 'POST',
      body: { delta: 30, reason: 'Bonus' },
    });
    expect(lost.status).toBe(503);
    const ops = (await (await admin(s, '/loyalty/operations')).json()) as {
      operations: { id: string; status: string; error: string | null }[];
    };
    expect(ops.operations.map((o) => [o.status, o.error])).toEqual([
      ['uncertain', 'network'],
      ['failed', 'daily_limit'],
    ]);
    const resolve = await admin(s, `/loyalty/operations/${ops.operations[0]?.id ?? ''}/resolve`, {
      method: 'POST',
    });
    expect(resolve.status).toBe(204);
    expect(s.admin.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['loyalty.settings', 'loyalty.operation.resolve']),
    );
    expect(s.logs.join('\n')).not.toContain(FAKE_PIN);
  });

  it('diagnostic YouFID réservé au super-administrateur, sans secret', async () => {
    const s = setup();
    const denied = await admin(s, `/tenants/${BELLA_ID}/youfid/test`, { method: 'POST' });
    expect(denied.status).toBe(403);
    const res = await admin(s, `/tenants/${BELLA_ID}/youfid/test`, {
      method: 'POST',
      email: 'admin@splash360.test',
    });
    const body = await res.json();
    expect(body).toEqual({ ok: true, merchantId: 4242, rewards: 2, secType: 'oauth1HmacSha256' });
    expect(JSON.stringify(body)).not.toContain('secret-de-test');
    const other = await admin(s, `/tenants/${GREEN_ID}/youfid/test`, {
      method: 'POST',
      email: 'admin@splash360.test',
    });
    expect(await other.json()).toMatchObject({ ok: false });
  });
});
