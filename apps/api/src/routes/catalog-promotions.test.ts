import {
  createDemoLoyaltyProvider,
  createMemoryDemoLoyaltyStore,
  type LoyaltyProgram,
} from '@splash360/api-loyalty';
import { createDemoMenuProvider, createMenuCache, type MenuProvider } from '@splash360/api-menu';
import {
  loyaltySessionSchema,
  menuSchema,
  placedOrderSchema,
  quoteSchema,
  type PlaceOrderRequest,
} from '@splash360/contracts';
import { cents, type CatalogRule } from '@splash360/core';
import { describe, expect, it } from 'vitest';
import { BELLA_ID, BELLA_RESTO, NOW, testSetup } from '../test-fixtures';

const json = { 'Content-Type': 'application/json' };
const base = '/v1/tenants/bella';

/** « 4e pizza offerte », une copie par mode comme le back-office Splash360. */
const fourth = (mode: CatalogRule['mode']): CatalogRule => ({
  id: `modifier4_${mode}`,
  name: '3 achetées = 1 offerte',
  mode,
  startsAt: NOW.getTime() - 86_400_000,
  endsAt: null,
  min: 4,
  max: 4,
  quantity: 0,
  productIds: ['p-margherita', 'p-regina'],
  selection: 'all',
  value: { kind: 'percent', hundredths: 10_000 },
  valueLabel: '100%',
  operation: -1,
  vatRate: 0,
});

const tenPercent: CatalogRule = {
  ...fourth('all'),
  id: 'dix_all',
  name: '10 % sur la commande',
  productIds: [],
  min: 0,
  max: 0,
  value: { kind: 'percent', hundredths: 1000 },
  valueLabel: '10%',
};

const bag: CatalogRule = {
  ...fourth('emporter'),
  id: 'sac_emporter',
  name: 'Sac',
  productIds: [],
  min: 0,
  max: 0,
  operation: 1,
  value: { kind: 'fixed', cents: cents(20) },
  valueLabel: '0.2€',
  vatRate: 0.2,
};

function withRules(rules: CatalogRule[]): MenuProvider {
  const demo = createDemoMenuProvider();
  return {
    async fetchMenu(source) {
      return { ...(await demo.fetchMenu(source)), catalogRules: rules };
    },
  };
}

const programs = new Map<string, LoyaltyProgram>([
  [
    'S360-DEMO-BELLA',
    {
      name: 'Club Bella',
      pointsPerEuro: 1,
      welcomePoints: 1000,
      rewards: [{ id: 'rw-pizza', name: 'Pizza', costPoints: 100, productIds: ['p-margherita'] }],
    },
  ],
]);

function setup(rules: CatalogRule[]) {
  return testSetup({
    menus: createMenuCache(withRules(rules), { ttlMs: 60_000, maxStaleMs: 0 }),
    loyalty: createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => 'carte-1-0000-0000-0000',
      programs,
    ),
    loyaltyDemoLogin: true,
  });
}

type Setup = ReturnType<typeof setup>;

const request = (
  lines: PlaceOrderRequest['lines'],
  extra: Partial<PlaceOrderRequest> = {},
): PlaceOrderRequest => ({
  restaurantId: BELLA_RESTO,
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: '2026-11-24T11:00:00.000Z' },
  lines,
  customer: {
    name: 'Camille',
    email: 'c@example.fr',
    phone: '0612345678',
    marketingConsent: false,
  },
  idempotencyKey: 'cle-promo-catalogue-0001',
  acceptedTerms: true,
  ...extra,
});

async function quote(s: Setup, body: PlaceOrderRequest) {
  const {
    restaurantId: _r,
    customer: _c,
    idempotencyKey: _k,
    acceptedTerms: _a,
    paymentMethod: _p,
    ...q
  } = body;
  return s.app.request(`${base}/restaurants/${BELLA_RESTO}/quote`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(q),
  });
}

const margherita = (quantity: number) => ({
  productId: 'p-margherita',
  quantity,
  optionIds: ['opt-normale'],
});
const regina = (quantity: number) => ({
  productId: 'p-regina',
  quantity,
  optionIds: ['opt-normale'],
});

describe('promotions de catalogue de la caisse (lot 24)', () => {
  it('4e offerte : la moins chère des quatre, sur la ligne, au devis et à la commande', async () => {
    const s = setup([fourth('surplace'), fourth('emporter'), fourth('livraison')]);
    const body = request([regina(3), margherita(1)]);
    const q = quoteSchema.parse(await (await quote(s, body)).json());
    // 3 × 12,90 + 10,50 = 49,20 ; Margherita (10,50) offerte → 38,70.
    expect(q.totals).toMatchObject({
      subtotalCents: 4920,
      catalogDiscountCents: 1050,
      totalCents: 3870,
    });
    expect(q.lines.map((l) => l.discounts)).toEqual([
      [],
      [{ name: '3 achetées = 1 offerte', units: 1, cents: 1050 }],
    ]);

    const res = await s.app.request(`${base}/orders`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const placed = placedOrderSchema.parse(await res.json());
    expect(placed.totals.totalCents).toBe(3870);
    const detail = await s.backend.reader.getOrderDetail(BELLA_ID, placed.orderId);
    expect(detail?.lines[1]?.discounts).toEqual([
      {
        ruleId: 'modifier4_emporter',
        name: '3 achetées = 1 offerte',
        units: 1,
        unitDiscountCents: 1050,
        percentLabel: '100%',
      },
    ]);
  });

  it('copie du mode seulement, et règle hors dates sans effet', async () => {
    const onlyDelivery = setup([fourth('livraison'), fourth('surplace')]);
    const q = quoteSchema.parse(await (await quote(onlyDelivery, request([regina(4)]))).json());
    expect(q.totals.catalogDiscountCents).toBe(0);
    const ended = setup([{ ...fourth('emporter'), endsAt: NOW.getTime() - 1 }]);
    const q2 = quoteSchema.parse(await (await quote(ended, request([regina(4)]))).json());
    expect(q2.totals.catalogDiscountCents).toBe(0);
  });

  it('remise commande sur le total déjà remisé, frais ajoutés : 4 × 12,90 → 51,60 − 12,90 − 3,87 + 0,20', async () => {
    const s = setup([tenPercent, fourth('emporter'), bag]);
    const q = quoteSchema.parse(await (await quote(s, request([regina(4)]))).json());
    expect(q.totals).toMatchObject({
      subtotalCents: 5160,
      catalogDiscountCents: 1290 + 387,
      catalogFeeCents: 20,
      totalCents: 5160 - 1290 - 387 + 20,
    });
    expect(q.adjustments).toEqual([
      { name: '10 % sur la commande', kind: 'discount', cents: 387 },
      { name: 'Sac', kind: 'fee', cents: 20 },
    ]);
  });

  it('code promo du client : il remplace la remise commande de la règle, calculé après la 4e offerte', async () => {
    const s = setup([tenPercent, fourth('emporter')]);
    s.backend.promos.push({
      id: '11111111-0000-4000-8000-000000000009',
      tenantId: BELLA_ID,
      code: 'CINQ',
      kind: 'percent',
      value: 5,
      minSubtotalCents: 0,
      startsAt: null,
      endsAt: null,
      maxUses: null,
      active: true,
      uses: 0,
    });
    const q = quoteSchema.parse(
      await (await quote(s, request([regina(4)], { promoCode: 'CINQ' }))).json(),
    );
    // 51,60 − 12,90 = 38,70 ; 5 % = 1,93 (arrondi à l'inférieur).
    expect(q.totals).toMatchObject({
      catalogDiscountCents: 1290,
      promoDiscountCents: 193,
      totalCents: 3870 - 193,
    });
    expect(q.adjustments).toEqual([]);
  });

  it('cadeau fidélité prioritaire : la pizza offerte n’est pas comptée par la règle', async () => {
    const s = setup([fourth('emporter')]);
    const session = loyaltySessionSchema.parse(
      await (
        await s.app.request(`${base}/loyalty/join`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            name: 'Camille',
            email: 'c@example.fr',
            phone: null,
            acceptedTerms: true,
          }),
        })
      ).json(),
    );
    const loyalty = {
      memberToken: session.memberToken,
      rewardId: 'rw-pizza',
      rewardProductId: 'p-margherita',
    };
    // 4 Margherita : une offerte par le cadeau, les 3 autres ne font pas un lot de 4.
    const q = quoteSchema.parse(
      await (await quote(s, request([margherita(4)], { loyalty }))).json(),
    );
    expect(q.totals).toMatchObject({ discountCents: 1050, catalogDiscountCents: 0 });
    // 5 Margherita : cadeau + 4e offerte parmi les 4 autres.
    const q5 = quoteSchema.parse(
      await (await quote(s, request([margherita(5)], { loyalty }))).json(),
    );
    expect(q5.totals).toMatchObject({
      discountCents: 1050,
      catalogDiscountCents: 1050,
      totalCents: 5250 - 2100,
    });
    // Points gagnés sur le montant payé, promotions comprises.
    expect(q5.loyalty?.pointsEarned).toBe(31);
  });

  it('commande rendue gratuite par les promotions : refusée', async () => {
    const s = setup([{ ...fourth('emporter'), min: 0, max: 0 }]);
    const res = await quote(s, request([margherita(1)]));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { issues: [{ code: 'catalog_needs_paid_amount' }] },
    });
  });

  it('badge « Promo » sur la carte : produits d’une règle en vigueur pour le mode demandé', async () => {
    const s = setup([fourth('emporter')]);
    const read = async (mode: string) =>
      menuSchema.parse(
        await (await s.app.request(`${base}/restaurants/${BELLA_RESTO}/menu?mode=${mode}`)).json(),
      );
    const pickup = (await read('pickup')).categories.flatMap((c) => c.products);
    expect(pickup.find((p) => p.id === 'p-margherita')?.promo).toBe('3 achetées = 1 offerte');
    expect(pickup.find((p) => p.id === 'p-tiramisu')?.promo).toBeNull();
    const delivery = (await read('delivery')).categories.flatMap((c) => c.products);
    expect(delivery.find((p) => p.id === 'p-margherita')?.promo).toBeNull();
  });
});
