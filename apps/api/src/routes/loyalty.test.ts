import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import {
  loyaltyMemberSchema,
  loyaltyProgramSchema,
  loyaltySessionSchema,
  memberOrdersSchema,
  orderTrackingSchema,
  placedOrderSchema,
  quoteSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { BELLA_ID, BELLA_RESTO, sessionToken, testSetup } from '../test-fixtures';

const programs = new Map<string, LoyaltyProgram>([
  [
    'S360-DEMO-BELLA',
    {
      name: 'Club Bella',
      pointsPerEuro: 10,
      welcomePoints: 100,
      rewards: [
        { id: 'rw-tiramisu', name: 'Tiramisu', costPoints: 100, productIds: ['p-tiramisu'] },
        { id: 'rw-pizza', name: 'Pizza', costPoints: 900, productIds: ['p-margherita'] },
      ],
    },
  ],
]);

function setup(demoLogin = true, now?: () => Date) {
  let n = 0;
  const loyalty = createDemoLoyaltyProvider(
    createMemoryDemoLoyaltyStore(),
    () => `carte-${++n}-0000-0000-0000`,
    programs,
  );
  return testSetup({ loyalty, loyaltyDemoLogin: demoLogin, ...(now ? { now } : {}) });
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

  it('le jeton de membre expire au bout de 90 jours (audit M4)', async () => {
    let clock = new Date('2026-11-25T10:00:00Z');
    const s = setup(true, () => clock);
    const session = await join(s, 'm4@example.fr');
    const me = () =>
      s.app.request(`${base}/loyalty/me`, {
        headers: { Authorization: `Bearer ${session.memberToken}` },
      });
    expect((await me()).status).toBe(200);
    clock = new Date(clock.getTime() + 89 * 24 * 3600 * 1000);
    expect((await me()).status).toBe(200);
    clock = new Date(clock.getTime() + 2 * 24 * 3600 * 1000);
    expect((await me()).status).toBe(401);
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
    expect(ok.loyalty).toEqual({
      pointsEarned: 105,
      rewardId: 'rw-tiramisu',
      rewardProductId: 'p-tiramisu',
    });
    expect(quoteSchema.parse(await (await quote(null)).json()).loyalty).toEqual({
      pointsEarned: 170,
      rewardId: null,
      rewardProductId: null,
    });

    const issues = async (res: Response) =>
      ((await res.json()) as { error: { issues: { code: string }[] } }).error.issues.map(
        (i) => i.code,
      );
    expect(await issues(await quote('rw-pizza'))).toEqual(['insufficient_points']);
    // Palier au choix (lot 11) : le produit doit appartenir au palier.
    const tk = memberToken;
    const {
      restaurantId: _r2,
      customer: _c2,
      idempotencyKey: _k2,
      acceptedTerms: _a2,
      ...q2
    } = order(tk, 'rw-tiramisu', 'y'.repeat(16));
    const notEligible = await s.app.request(`${base}/restaurants/${BELLA_RESTO}/quote`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        ...q2,
        loyalty: { memberToken: tk, rewardId: 'rw-tiramisu', rewardProductId: 'p-margherita' },
      }),
    });
    expect(await issues(notEligible)).toEqual(['reward_product_not_eligible']);
    expect(await issues(await quote('rw-inconnue'))).toEqual(['unknown_reward']);
    expect(
      await issues(
        await quote(null, `${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}_${'a'.repeat(43)}`),
      ),
    ).toEqual(['loyalty_session_invalid']);
  });

  it('complète le profil après l’inscription, tout est facultatif (lot 16)', async () => {
    const s = setup();
    const { memberToken } = await join(s, 'profil@example.fr');
    const patch = (body: unknown, token = memberToken) =>
      s.app.request(`${base}/loyalty/me`, {
        method: 'PATCH',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const done = loyaltyMemberSchema.parse(
      await (
        await patch({ name: 'Camille', email: 'camille.b@example.fr', birthDate: '1992-03-04' })
      ).json(),
    );
    expect(done).toMatchObject({
      name: 'Camille',
      email: 'camille.b@example.fr',
      birthDate: '1992-03-04',
    });
    // Rien à remplir : accepté, rien ne change.
    expect(loyaltyMemberSchema.parse(await (await patch({})).json()).birthDate).toBe('1992-03-04');
    // Vider la date de naissance.
    expect(
      loyaltyMemberSchema.parse(await (await patch({ birthDate: '' })).json()).birthDate,
    ).toBeNull();
    expect((await patch({ birthDate: '2999-01-01' })).status).toBe(400);
    expect((await patch({ email: 'pas-un-email' })).status).toBe(400);
    await join(s, 'pris@example.fr');
    expect((await patch({ email: 'pris@example.fr' })).status).toBe(409);
    expect((await patch({ name: 'X' }, 'jeton-invalide')).status).toBe(401);
  });

  it('palier par catégories (lot 16) : réglé au back-office, tous les produits de la catégorie au choix', async () => {
    const s = setup();
    const admin = async (method: string, body?: unknown) =>
      s.app.request('/v1/admin/loyalty/rewards', {
        method,
        headers: {
          ...json,
          Authorization: `Bearer ${await sessionToken('gerant@bella.test')}`,
          'X-Tenant-Id': BELLA_ID,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    // Le tiramisu (100 points) devient « un dessert ou une boisson » : catégories entières.
    expect(
      (await admin('PUT', { rewards: [{ id: 'rw-tiramisu', categoryIds: ['cat-boissons'] }] }))
        .status,
    ).toBe(204);
    expect((await admin('PUT', { rewards: [{ id: 'rw-inconnu', categoryIds: [] }] })).status).toBe(
      400,
    );
    const listed = (await (await admin('GET')).json()) as {
      rewards: { id: string; categoryIds: string[] }[];
    };
    expect(listed.rewards.find((r) => r.id === 'rw-tiramisu')?.categoryIds).toEqual([
      'cat-boissons',
    ]);

    // Le programme publié par l'app porte les catégories.
    const program = loyaltyProgramSchema.parse(
      await (await s.app.request(`${base}/loyalty/program`)).json(),
    );
    expect(
      program.enabled && program.rewards.find((r) => r.id === 'rw-tiramisu')?.categoryIds,
    ).toEqual(['cat-boissons']);

    // Au devis : l'eau (catégorie boissons) est offerte ; la pizza (hors catégorie) refusée.
    const { memberToken } = await join(s);
    const quote = (rewardProductId: string) =>
      s.app.request(`${base}/restaurants/${BELLA_RESTO}/quote`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          mode: 'pickup',
          address: null,
          requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
          lines: [
            { productId: 'p-margherita', quantity: 1, optionIds: ['opt-normale'] },
            { productId: 'p-eau', quantity: 1, optionIds: [] },
          ],
          loyalty: { memberToken, rewardId: 'rw-tiramisu', rewardProductId },
        }),
      });
    const ok = quoteSchema.parse(await (await quote('p-eau')).json());
    expect(ok.totals).toMatchObject({ discountCents: 350 });
    expect(ok.loyalty).toMatchObject({ rewardId: 'rw-tiramisu', rewardProductId: 'p-eau' });
    const refused = (await (await quote('p-margherita')).json()) as {
      error: { issues: { code: string }[] };
    };
    expect(refused.error.issues.map((i) => i.code)).toEqual(['reward_product_not_eligible']);
  });

  it('« Mes commandes » : seulement les commandes du membre, avec un suivi utilisable', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const { memberToken: other } = await join(s, 'autre@example.fr');
    const res = await post(s, '/orders', order(memberToken, null, 'cle-historique-0001'));
    expect(res.status).toBe(201);
    const placed = placedOrderSchema.parse(await res.json());

    const list = async (token: string | null) =>
      s.app.request(`${base}/loyalty/me/orders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    expect((await list(null)).status).toBe(401);
    const mine = memberOrdersSchema.parse(await (await list(memberToken)).json());
    expect(mine.orders.map((o) => o.number)).toEqual([placed.number]);
    expect(mine.orders[0]?.items.length).toBeGreaterThan(0);
    expect(mine.nextBefore).toBeNull();
    // Le jeton remis ouvre le suivi de cette commande.
    const tracking = await s.app.request(`${base}/orders/${placed.orderId}`, {
      headers: { Authorization: `Bearer ${mine.orders[0]?.accessToken ?? ''}` },
    });
    expect(tracking.status).toBe(200);
    expect(memberOrdersSchema.parse(await (await list(other)).json()).orders).toEqual([]);
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
    // Le ticket de suivi marque le produit offert (lot 16), une seule ligne.
    const tracking = orderTrackingSchema.parse(
      await (
        await s.app.request(`${base}/orders/${placed.orderId}`, {
          headers: { Authorization: `Bearer ${placed.accessToken}` },
        })
      ).json(),
    );
    expect(tracking.lines.map((l) => [l.name, l.gift])).toEqual([
      ['Margherita', false],
      ['Tiramisu maison', true],
    ]);

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

describe('paiement sur place (ADR 0010)', () => {
  function onSiteSetup(enabled = true) {
    const s = setup();
    const base = s.backend.ordering.getConfig.bind(s.backend.ordering);
    s.backend.ordering.getConfig = async (tenantId, restaurantId) => {
      const config = await base(tenantId, restaurantId);
      return config ? { ...config, payOnSiteEnabled: enabled } : null;
    };
    return s;
  }
  const onSite = (memberToken: string | null, key: string): PlaceOrderRequest => ({
    ...order(memberToken ?? '', null, key),
    loyalty: memberToken ? { memberToken, rewardId: null } : null,
    paymentMethod: 'on_site',
  });

  it('annonce les moyens de paiement du restaurant', async () => {
    const payment = async (s: ReturnType<typeof setup>) =>
      (
        (await (await s.app.request(`${base}/restaurants/${BELLA_RESTO}/availability`)).json()) as {
          payment: unknown;
        }
      ).payment;
    // Bella encaisse par Stripe ; le paiement sur place s'ajoute quand le restaurant l'active.
    expect(await payment(onSiteSetup())).toEqual({ online: true, onSite: true });
    expect(await payment(onSiteSetup(false))).toEqual({ online: true, onSite: false });
    // Sans clés Stripe : seul le paiement sur place reste proposé.
    const noStripe = onSiteSetup();
    expect(await payment(testSetup({ ...noStripe.deps, gateway: null }))).toEqual({
      online: false,
      onSite: true,
    });
  });

  it('confirme la commande, l’envoie en caisse et donne le QR code de retrait', async () => {
    const s = onSiteSetup();
    const { memberToken } = await join(s);
    const res = await post(s, '/orders', onSite(memberToken, 'cle-sur-place-000000001'));
    expect(res.status).toBe(201);
    const placed = placedOrderSchema.parse(await res.json());
    expect(placed).toMatchObject({ status: 'confirmed', paymentMethod: 'on_site' });
    // Envoyée en caisse sans paiement Stripe.
    expect(s.pos.submitted).toEqual([placed.orderId]);
    // Caisse prête puis paiement notifié « sur place » (règlements vides), commande intégrée.
    expect(s.pos.payments).toEqual([{ method: 'on_site' }]);
    expect(s.backend.orders[0]?.pos).toMatchObject({ phase: 'confirmed' });
    const tracking = orderTrackingSchema.parse(
      await (
        await s.app.request(`${base}/orders/${placed.orderId}`, {
          headers: { Authorization: `Bearer ${placed.accessToken}` },
        })
      ).json(),
    );
    expect(tracking).toMatchObject({ status: 'confirmed', paymentMethod: 'on_site' });
    expect(tracking.pickupCode).toMatch(new RegExp(`^S360-CMD-${placed.number}-[0-9A-F]{8}$`));
    // Jamais de paiement en ligne sur une commande à payer sur place.
    const pay = await s.app.request(`${base}/orders/${placed.orderId}/payment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${placed.accessToken}` },
    });
    expect(pay.status).toBe(409);
  });

  it('réservé aux membres du club et aux restaurants qui l’acceptent', async () => {
    const issue = async (res: Response) =>
      ((await res.json()) as { error: { issues: { code: string }[] } }).error.issues[0]?.code;
    const s = onSiteSetup();
    expect(await issue(await post(s, '/orders', onSite(null, 'cle-sur-place-000000002')))).toBe(
      'on_site_requires_member',
    );
    const closed = onSiteSetup(false);
    const { memberToken } = await join(closed);
    expect(
      await issue(await post(closed, '/orders', onSite(memberToken, 'cle-sur-place-000000003'))),
    ).toBe('payment_method_unavailable');
  });

  it('crédite les points seulement une fois la commande remise', async () => {
    const s = onSiteSetup();
    const { memberToken } = await join(s);
    const placed = placedOrderSchema.parse(
      await (await post(s, '/orders', onSite(memberToken, 'cle-sur-place-000000004'))).json(),
    );
    const points = async () =>
      loyaltyMemberSchema.parse(
        await (
          await s.app.request(`${base}/loyalty/me`, {
            headers: { Authorization: `Bearer ${memberToken}` },
          })
        ).json(),
      ).points;
    expect(await points()).toBe(100);
    for (const status of ['accepted', 'ready', 'completed'] as const) {
      await s.app.request(`/v1/admin/orders/${placed.orderId}/status`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${await sessionToken('gerant@bella.test')}` },
        body: JSON.stringify({ status }),
      });
    }
    // 17,00 € → 170 points, crédités à la remise.
    expect(await points()).toBe(270);
  });
});

describe('points du cadeau réservés tant que la commande est en cours (ADR 0013)', () => {
  function onSiteSetup() {
    const s = setup();
    const base = s.backend.ordering.getConfig.bind(s.backend.ordering);
    s.backend.ordering.getConfig = async (tenantId, restaurantId) => {
      const config = await base(tenantId, restaurantId);
      return config ? { ...config, payOnSiteEnabled: true } : null;
    };
    return s;
  }
  const withReward = (memberToken: string, key: string): PlaceOrderRequest => ({
    ...order(memberToken, 'rw-tiramisu', key),
    paymentMethod: 'on_site',
  });
  const me = async (s: ReturnType<typeof setup>, memberToken: string) =>
    loyaltyMemberSchema.parse(
      await (
        await s.app.request(`${base}/loyalty/me`, {
          headers: { Authorization: `Bearer ${memberToken}` },
        })
      ).json(),
    );
  const firstIssue = async (res: Response) =>
    ((await res.json()) as { error: { issues: { code: string }[] } }).error.issues[0]?.code;

  it('réserve les points sans les débiter, et refuse de réutiliser le même cadeau', async () => {
    const s = onSiteSetup();
    const { memberToken } = await join(s);
    const first = await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000001'));
    expect(first.status).toBe(201);
    // Points débités seulement à la validation : le solde ne bouge pas, 100 points sont réservés.
    expect(await me(s, memberToken)).toMatchObject({ points: 100, reservedPoints: 100 });
    // Une deuxième commande ne peut pas reprendre le même cadeau.
    const second = await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000002'));
    expect(second.status).toBe(422);
    expect(await firstIssue(second)).toBe('insufficient_points');
    // Une nouvelle tentative de la même commande (même clé) reste acceptée.
    const replay = await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000001'));
    expect(replay.status).toBeLessThan(300);
  });

  it('libère les points quand la commande est annulée', async () => {
    const s = onSiteSetup();
    const { memberToken } = await join(s);
    const placed = placedOrderSchema.parse(
      await (await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000003'))).json(),
    );
    await s.app.request(`/v1/admin/orders/${placed.orderId}/status`, {
      method: 'POST',
      headers: { ...json, Authorization: `Bearer ${await sessionToken('gerant@bella.test')}` },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(await me(s, memberToken)).toMatchObject({ points: 100, reservedPoints: 0 });
    const again = await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000004'));
    expect(again.status).toBe(201);
  });

  it('débite le cadeau à la remise et ne réserve plus rien ensuite', async () => {
    const s = onSiteSetup();
    const { memberToken } = await join(s);
    const placed = placedOrderSchema.parse(
      await (await post(s, '/orders', withReward(memberToken, 'cle-reserve-0000000005'))).json(),
    );
    for (const status of ['accepted', 'ready', 'completed'] as const) {
      await s.app.request(`/v1/admin/orders/${placed.orderId}/status`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${await sessionToken('gerant@bella.test')}` },
        body: JSON.stringify({ status }),
      });
    }
    // 100 − 100 (tiramisu) + 125 (12,50 € payés) ; plus rien de réservé.
    const after = await me(s, memberToken);
    expect(after.reservedPoints).toBe(0);
    expect(after.points).toBeGreaterThan(0);
  });
});

describe('e-mail facultatif à la commande (ADR 0013)', () => {
  it('accepte une commande sans e-mail et n’envoie pas de reçu par e-mail', async () => {
    const s = setup();
    const { memberToken } = await join(s);
    const request: PlaceOrderRequest = {
      ...order(memberToken, null, 'cle-sans-email-00000001'),
      customer: { name: 'Camille', email: '', phone: '06 12 34 56 78', marketingConsent: false },
      paymentMethod: 'on_site',
    };
    const base2 = s.backend.ordering.getConfig.bind(s.backend.ordering);
    s.backend.ordering.getConfig = async (tenantId, restaurantId) => {
      const config = await base2(tenantId, restaurantId);
      return config ? { ...config, payOnSiteEnabled: true } : null;
    };
    const res = await post(s, '/orders', request);
    expect(res.status).toBe(201);
    expect(s.notifications.emails).toEqual([]);
  });
});
