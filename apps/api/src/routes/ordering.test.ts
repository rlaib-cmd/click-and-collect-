import {
  apiErrorSchema,
  availabilitySchema,
  placedOrderSchema,
  quoteSchema,
  slotsSchema,
  type PlaceOrderRequest,
  type QuoteRequest,
} from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { BELLA_RESTO, GREEN_RESTO, testApp } from '../test-fixtures';

const base = `/v1/tenants/bella/restaurants/${BELLA_RESTO}`;
const noon = '2026-11-24T11:00:00.000Z'; // 12:00 à Paris
const post = (app: ReturnType<typeof testApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

const margheritaGrande = { productId: 'p-margherita', quantity: 1, optionIds: ['opt-grande'] };
const near = {
  label: '8 Boulevard Richard-Lenoir 75011 Paris',
  postalCode: '75011',
  city: 'Paris',
  latitude: 48.8565,
  longitude: 2.3707,
};
const far = {
  label: 'Versailles',
  postalCode: '78000',
  city: 'Versailles',
  latitude: 48.8015,
  longitude: 2.1301,
};

const pickupAtNoon: QuoteRequest = {
  mode: 'pickup',
  address: null,
  requestedTime: { kind: 'scheduled', at: noon },
  lines: [margheritaGrande],
};

const order = (over: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
  ...pickupAtNoon,
  restaurantId: BELLA_RESTO,
  customer: {
    name: 'Camille Martin',
    email: 'camille@example.fr',
    phone: '06 12 34 56 78',
    marketingConsent: false,
  },
  idempotencyKey: 'cle-unique-0000000001',
  acceptedTerms: true,
  ...over,
});

async function issues(res: Response) {
  return apiErrorSchema.parse(await res.json()).error.issues?.map((i) => i.code);
}

describe('disponibilité et créneaux', () => {
  it('restaurant fermé à 10 h : « dès que possible » indisponible, jours proposés', async () => {
    const res = await testApp().request(`${base}/availability`);
    const body = availabilitySchema.parse(await res.json());
    expect(body.asap.available).toBe(false);
    expect(body.modes).toEqual({ pickup: true, delivery: true });
    expect(body.dates[0]).toBe('2026-11-24');
    expect(body.dates).not.toContain('2026-11-30'); // lundi
    expect(body.delivery).toEqual({ minimumCents: 1500, freeThresholdCents: 3500 });
  });

  it('liste les créneaux du jour', async () => {
    const res = await testApp().request(`${base}/slots?mode=pickup&date=2026-11-24`);
    const body = slotsSchema.parse(await res.json());
    expect(body.slots[0]).toMatchObject({ label: '11:30', remaining: 2 });
  });

  it('refuse des paramètres manquants', async () => {
    expect((await testApp().request(`${base}/slots?date=2026-11-24`)).status).toBe(400);
  });
});

describe('devis (recontrôle serveur)', () => {
  it('calcule le retrait planifié', async () => {
    const res = await post(testApp(), `${base}/quote`, pickupAtNoon);
    expect(res.status).toBe(200);
    const body = quoteSchema.parse(await res.json());
    expect(body.totals).toEqual({
      subtotalCents: 1450,
      deliveryFeeCents: 0,
      serviceFeeCents: 0,
      discountCents: 0,
      promoDiscountCents: 0,
      totalCents: 1450,
    });
    expect(body.at).toBe(noon);
    expect(body.lines[0]?.options[0]?.name).toBe('Grande (40 cm)');
  });

  it('ignore tout prix envoyé par l’application', async () => {
    const tampered = {
      ...pickupAtNoon,
      lines: [{ ...margheritaGrande, priceCents: 1, unitPriceCents: 1 }],
    };
    const body = quoteSchema.parse(await (await post(testApp(), `${base}/quote`, tampered)).json());
    expect(body.totals.totalCents).toBe(1450);
  });

  it('livraison : frais de zone, minimum et hors zone', async () => {
    const app = testApp();
    const ok = await post(app, `${base}/quote`, {
      ...pickupAtNoon,
      mode: 'delivery',
      address: near,
      lines: [{ ...margheritaGrande, quantity: 2 }],
    });
    const okJson: unknown = await ok.json();
    expect(quoteSchema.parse(okJson).totals).toMatchObject({
      subtotalCents: 2900,
      deliveryFeeCents: 190,
    });

    const free = await post(app, `${base}/quote`, {
      ...pickupAtNoon,
      mode: 'delivery',
      address: near,
      lines: [{ ...margheritaGrande, quantity: 3 }],
    });
    expect(quoteSchema.parse(await free.json()).totals.deliveryFeeCents).toBe(0);

    const small = await post(app, `${base}/quote`, {
      ...pickupAtNoon,
      mode: 'delivery',
      address: near,
      lines: [{ productId: 'p-tiramisu', quantity: 1, optionIds: [] }],
    });
    expect(small.status).toBe(422);
    const smallBody = apiErrorSchema.parse(await small.json());
    expect(smallBody.error.issues).toEqual([{ code: 'below_delivery_minimum', missingCents: 850 }]);

    const out = await post(app, `${base}/quote`, {
      ...pickupAtNoon,
      mode: 'delivery',
      address: far,
    });
    expect(await issues(out)).toEqual(['out_of_delivery_zone']);

    const noAddress = await post(app, `${base}/quote`, { ...pickupAtNoon, mode: 'delivery' });
    expect(await issues(noAddress)).toEqual(['address_required']);
  });

  it('renvoie tous les problèmes d’un coup', async () => {
    const res = await post(testApp(), `${base}/quote`, {
      ...pickupAtNoon,
      requestedTime: { kind: 'asap' },
      lines: [
        { productId: 'p-margherita', quantity: 1, optionIds: [] },
        { productId: 'p-diavola', quantity: 1, optionIds: ['opt-normale'] },
      ],
    });
    expect(res.status).toBe(422);
    expect(await issues(res)).toEqual([
      'too_few_options',
      'product_unavailable',
      'restaurant_closed',
    ]);
  });

  it('refuse un créneau hors grille', async () => {
    const res = await post(testApp(), `${base}/quote`, {
      ...pickupAtNoon,
      requestedTime: { kind: 'scheduled', at: '2026-11-24T11:07:00.000Z' },
    });
    expect(await issues(res)).toEqual(['slot_unavailable']);
  });
});

describe('création de commande', () => {
  it('crée la commande en attente de paiement, avec les montants du serveur', async () => {
    const app = testApp();
    const res = await post(app, `/v1/tenants/bella/orders`, order());
    expect(res.status).toBe(201);
    const body = placedOrderSchema.parse(await res.json());
    expect(body).toMatchObject({
      status: 'pending_payment',
      number: 1001,
      totals: { totalCents: 1450 },
    });
  });

  it('est idempotente : le même envoi ne crée pas deux commandes', async () => {
    const app = testApp();
    const first = placedOrderSchema.parse(
      await (await post(app, `/v1/tenants/bella/orders`, order())).json(),
    );
    const again = await post(app, `/v1/tenants/bella/orders`, order());
    expect(again.status).toBe(200);
    expect(placedOrderSchema.parse(await again.json()).orderId).toBe(first.orderId);
  });

  it('respecte le maximum de commandes par créneau', async () => {
    const app = testApp();
    for (const k of ['cle-unique-0000000001', 'cle-unique-0000000002']) {
      expect(
        (await post(app, `/v1/tenants/bella/orders`, order({ idempotencyKey: k }))).status,
      ).toBe(201);
    }
    const third = await post(
      app,
      `/v1/tenants/bella/orders`,
      order({ idempotencyKey: 'cle-unique-0000000003' }),
    );
    expect(third.status).toBe(422);
    expect(await issues(third)).toEqual(['slot_unavailable']);
  });

  it('exige l’acceptation des conditions et un client valide', async () => {
    const app = testApp();
    expect(
      (await post(app, `/v1/tenants/bella/orders`, { ...order(), acceptedTerms: false })).status,
    ).toBe(400);
    const badEmail = order({
      customer: {
        name: 'A B',
        email: 'pas-un-email',
        phone: '0612345678',
        marketingConsent: false,
      },
    });
    expect((await post(app, `/v1/tenants/bella/orders`, badEmail)).status).toBe(400);
  });

  it("refuse de commander dans le restaurant d'une autre enseigne", async () => {
    const res = await post(
      testApp(),
      `/v1/tenants/bella/orders`,
      order({ restaurantId: GREEN_RESTO }),
    );
    expect(res.status).toBe(404);
  });
});

describe('suggestions d’adresse', () => {
  it('cherche une adresse', async () => {
    const res = await testApp().request('/v1/tenants/bella/geo/search?q=richard lenoir');
    const body = (await res.json()) as { results: { postalCode: string }[] };
    expect(body.results[0]?.postalCode).toBe('75011');
  });
});
