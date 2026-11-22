import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  loyaltyMemberSchema,
  loyaltyProgramSchema,
  loyaltySessionSchema,
  placedOrderSchema,
  quoteSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { BELLA_RESTO, testSetup } from '../test-fixtures';

const programs = new Map<string, LoyaltyProgram>([
  [
    'S360-DEMO-BELLA',
    {
      name: 'Club Bella',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [
        { id: 'rw-tiramisu', name: 'Tiramisu', costPoints: 100, productId: 'p-tiramisu' },
        { id: 'rw-pizza', name: 'Pizza', costPoints: 900, productId: 'p-margherita' },
      ],
    },
  ],
]);

function setup(demoLogin = true) {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  return testSetup({ loyalty, loyaltyDemoLogin: demoLogin });
}

const json = { 'Content-Type': 'application/json' };
const base = '/v1/tenants/bella';
const post = (s: ReturnType<typeof setup>, path: string, body: unknown, headers = {}) =>
  s.app.request(`${base}${path}`, {
    method: 'POST',
    headers: { ...json, ...headers },
    body: JSON.stringify(body),
  });
const join = async (s: ReturnType<typeof setup>, email = 'camille@example.fr') =>
  loyaltySessionSchema.parse(
    await (
      await post(s, '/loyalty/join', { name: 'Camille', email, phone: null, acceptedTerms: true })
    ).json(),
  );

const order = (memberToken: string, rewardId: string | null, key: string): PlaceOrderRequest => ({
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
  lines: [
    { productId: 'p-margherita', quantity: 1, optionIds: ['opt-normale'] },
    { productId: 'p-tiramisu', quantity: 1, optionIds: [] },
  ],
  customer: {
    name: 'Camille',
    email: 'camille@example.fr',
    phone: '0612345678',
    marketingConsent: false,
  },
  idempotencyKey: key,
  acceptedTerms: true,
  loyalty: { memberToken, rewardId },
});

describe('club fidélité', () => {
  it('publie le programme, ou « pas de club » pour une enseigne sans programme', async () => {
    const s = setup();
    const bella = loyaltyProgramSchema.parse(
      await (await s.app.request(`${base}/loyalty/program`)).json(),
    );
    expect(bella).toMatchObject({ enabled: true, pointsPerEuro: 10, demo: true });
    expect(await (await s.app.request('/v1/tenants/greenbowl/loyalty/program')).json()).toEqual({
      enabled: false,
    });
    expect(await (await testSetup().app.request(`${base}/loyalty/program`)).json()).toEqual({
      enabled: false,
    });
  });

  it('inscrit avec les points de bienvenue et protège le compte par un jeton lié à l’enseigne', async () => {
    const s = setup();
    const session = await join(s);
    expect(session.member).toMatchObject({
      points: 100,
      nextReward: { name: 'Pizza', missingPoints: 800 },
    });
    const me = await s.app.request(`${base}/loyalty/me`, {
      headers: { Authorization: `Bearer ${session.memberToken}` },
    });
    expect(loyaltyMemberSchema.parse(await me.json()).cardCode).toBe(session.member.cardCode);
    expect((await s.app.request(`${base}/loyalty/me`)).status).toBe(401);
    const forged = session.memberToken.slice(0, -2) + 'xx';
    expect(
      (
        await s.app.request(`${base}/loyalty/me`, {
          headers: { Authorization: `Bearer ${forged}` },
        })
      ).status,
    ).toBe(401);
    // Même jeton présenté à une autre enseigne : refusé.
    expect(
      (
        await s.app.request('/v1/tenants/greenbowl/loyalty/me', {
          headers: { Authorization: `Bearer ${session.memberToken}` },
        })
      ).status,
    ).toBe(401);
  });

  it('connexion par e-mail seulement avec les données de test', async () => {
    const demo = setup(true);
    await join(demo);
    expect((await post(demo, '/loyalty/login', { email: 'CAMILLE@example.fr' })).status).toBe(200);
    expect((await post(demo, '/loyalty/login', { email: 'inconnu@example.fr' })).status).toBe(404);

    const real = setup(false);
    await join(real);
    expect((await post(real, '/loyalty/login', { email: 'camille@example.fr' })).status).toBe(404);
    // Sans vérification, s'inscrire avec un e-mail déjà inscrit ne donne pas le compte.
    expect(
      (
        await post(real, '/loyalty/join', {
          name: 'Autre',
          email: 'camille@example.fr',
          phone: null,
          acceptedTerms: true,
        })
      ).status,
    ).toBe(409);
  });

  it('déduit la récompense au devis et refuse ce qui ne va pas', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const quote = async (rewardId: string | null, token = memberToken) => {
      const {
        restaurantId: _r,
        customer: _c,
        idempotencyKey: _k,
        acceptedTerms: _a,
        ...q
      } = order(token, rewardId, 'x'.repeat(16));
      return s.app.request(`${base}/restaurants/${BELLA_RESTO}/quote`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify(q),
      });
    };
    const ok = quoteSchema.parse(await (await quote('rw-tiramisu')).json());
    // Margherita 10,50 + tiramisu 6,50 = 17,00 ; tiramisu offert → 10,50 € ; 105 points.
    expect(ok.totals).toMatchObject({ subtotalCents: 1700, discountCents: 650, totalCents: 1050 });
    expect(ok.loyalty).toEqual({ pointsEarned: 105, rewardId: 'rw-tiramisu' });
    expect(quoteSchema.parse(await (await quote(null)).json()).loyalty).toEqual({
      pointsEarned: 170,
      rewardId: null,
    });

    const issues = async (res: Response) =>
      ((await res.json()) as { error: { issues: { code: string }[] } }).error.issues.map(
        (i) => i.code,
      );
    expect(await issues(await quote('rw-pizza'))).toEqual(['insufficient_points']);
    expect(await issues(await quote('rw-inconnue'))).toEqual(['unknown_reward']);
    expect(
      await issues(
        await quote(null, `${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}_${'a'.repeat(43)}`),
      ),
    ).toEqual(['loyalty_session_invalid']);
  });

  it('crédite les points et consomme la récompense au paiement, une seule fois', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const res = await post(
      s,
      '/orders',
      order(memberToken, 'rw-tiramisu', 'cle-fidelite-00000001'),
    );
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
    const me = loyaltyMemberSchema.parse(
      await (
        await s.app.request(`${base}/loyalty/me`, {
          headers: { Authorization: `Bearer ${memberToken}` },
        })
      ).json(),
    );
    // 100 de bienvenue − 100 (tiramisu) + 105 gagnés.
    expect(me.points).toBe(105);
    expect(me.history.map((h) => h.kind)).toEqual(['earn', 'redeem', 'welcome']);
    expect(s.backend.orders[0]?.loyaltySettled).toBe(true);
  });
});
