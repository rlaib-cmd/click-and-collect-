import {
  adminPromosSchema,
  placedOrderSchema,
  quoteSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { BELLA_ID, BELLA_RESTO, sessionToken, testSetup } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };
const base = '/v1/tenants/bella';

const order = (
  key: string,
  promoCode: string | null,
  email = 'camille@example.fr',
  at = '2026-11-24T11:00:00.000Z',
): PlaceOrderRequest => ({
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at },
  lines: [{ productId: 'p-margherita', quantity: 2, optionIds: ['opt-normale'] }],
  customer: { name: 'Camille', email, phone: '0612345678', marketingConsent: false },
  idempotencyKey: key,
  acceptedTerms: true,
  promoCode,
});

function setup() {
  const s = testSetup();
  s.backend.promos.push(
    {
      id: '11111111-0000-4000-8000-000000000001',
      tenantId: BELLA_ID,
      code: 'BIENVENUE',
      kind: 'percent',
      value: 10,
      minSubtotalCents: 1500,
      startsAt: null,
      endsAt: null,
      maxUses: 2,
      active: true,
      uses: 0,
    },
    {
      id: '11111111-0000-4000-8000-000000000002',
      tenantId: BELLA_ID,
      code: 'FINI',
      kind: 'fixed',
      value: 300,
      minSubtotalCents: 0,
      startsAt: null,
      endsAt: new Date('2020-01-01T00:00:00Z'),
      maxUses: null,
      active: true,
      uses: 0,
    },
  );
  return s;
}

const quote = (
  s: ReturnType<typeof setup>,
  promoCode: string | null,
  at = '2026-11-24T11:00:00.000Z',
) => {
  const {
    restaurantId: _r,
    customer: _c,
    idempotencyKey: _k,
    acceptedTerms: _a,
    ...q
  } = order('x'.repeat(16), promoCode, 'devis@example.fr', at);
  return s.app.request(`${base}/restaurants/${BELLA_RESTO}/quote`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(q),
  });
};
const codes = async (res: Response) =>
  ((await res.json()) as { error: { issues: { code: string }[] } }).error.issues.map((i) => i.code);
const place = (s: ReturnType<typeof setup>, key: string, promo: string | null, email?: string) =>
  s.app.request(`${base}/orders`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(order(key, promo, email)),
  });

describe('codes promo', () => {
  it('applique la remise au devis, saisie insensible à la casse', async () => {
    const s = setup();
    const q = quoteSchema.parse(await (await quote(s, ' bienvenue ')).json());
    // 2 × 10,50 = 21,00 ; −10 % = −2,10.
    expect(q.totals).toMatchObject({
      subtotalCents: 2100,
      promoDiscountCents: 210,
      totalCents: 1890,
    });
    expect(q.promoCode).toBe('BIENVENUE');
  });

  it('refuse un code inconnu ou expiré', async () => {
    const s = setup();
    expect(await codes(await quote(s, 'NIMPORTE'))).toEqual(['promo_invalid']);
    expect(await codes(await quote(s, 'FINI'))).toEqual(['promo_expired']);
  });

  it('une fois par client, et pas au-delà du nombre d’utilisations', async () => {
    const s = setup();
    const first = await place(s, 'cle-promo-00000001', 'BIENVENUE');
    expect(first.status).toBe(201);
    expect(placedOrderSchema.parse(await first.json()).totals.promoDiscountCents).toBe(210);
    // Même client (même e-mail) : refusé.
    expect(await codes(await place(s, 'cle-promo-00000002', 'BIENVENUE'))).toEqual([
      'promo_already_used',
    ]);
    // Un autre client : accepté (2e et dernière utilisation).
    expect((await place(s, 'cle-promo-00000003', 'BIENVENUE', 'paul@example.fr')).status).toBe(201);
    // Plus d'utilisation : refusé dès le devis.
    expect(await codes(await quote(s, 'BIENVENUE', '2026-11-24T11:30:00.000Z'))).toContain(
      'promo_exhausted',
    );
  });

  it('back-office : créer, lister, désactiver ; le devis refuse alors le code', async () => {
    const s = setup();
    const headers = { Authorization: `Bearer ${await sessionToken('gerant@bella.test')}` };
    const create = await s.app.request('/v1/admin/promos', {
      method: 'POST',
      headers: { ...json, ...headers },
      body: JSON.stringify({
        code: 'noel-24',
        kind: 'fixed',
        value: 300,
        minSubtotalCents: 0,
        startsAt: null,
        endsAt: null,
        maxUses: null,
      }),
    });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const list = adminPromosSchema.parse(
      await (await s.app.request('/v1/admin/promos', { headers })).json(),
    );
    expect(list.promos.find((p) => p.id === id)).toMatchObject({ code: 'NOEL-24', active: true });
    expect(
      quoteSchema.parse(await (await quote(s, 'noel-24')).json()).totals.promoDiscountCents,
    ).toBe(300);
    await s.app.request(`/v1/admin/promos/${id}`, {
      method: 'PATCH',
      headers: { ...json, ...headers },
      body: JSON.stringify({ active: false }),
    });
    expect(await codes(await quote(s, 'NOEL-24'))).toEqual(['promo_invalid']);
    // Pourcentage au-delà de 100 : refusé.
    const bad = await s.app.request('/v1/admin/promos', {
      method: 'POST',
      headers: { ...json, ...headers },
      body: JSON.stringify({
        code: 'TROP',
        kind: 'percent',
        value: 150,
        minSubtotalCents: 0,
        startsAt: null,
        endsAt: null,
        maxUses: null,
      }),
    });
    expect(bad.status).toBe(400);
  });
});
