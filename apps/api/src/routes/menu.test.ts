import { menuSchema, restaurantListSchema } from '@splash360/contracts';
import { createMenuCache } from '@splash360/api-menu';
import { cents } from '@splash360/core';
import { describe, expect, it } from 'vitest';
import { BELLA_RESTO, GREEN_RESTO, testApp } from '../test-fixtures';

const app = testApp();

describe('restaurants et carte', () => {
  it('liste les restaurants de l’enseigne seulement', async () => {
    const res = await app.request('/v1/tenants/bella/restaurants');
    const body = restaurantListSchema.parse(await res.json());
    expect(body.restaurants.map((r) => r.id)).toEqual([BELLA_RESTO]);
  });

  it('sert la carte conforme au contrat, catégories dans l’ordre', async () => {
    const res = await app.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu`);
    expect(res.status).toBe(200);
    const menu = menuSchema.parse(await res.json());
    expect(menu.stale).toBe(false);
    expect(menu.categories.map((c) => c.name)).toEqual(['Pizzas', 'Menus', 'Desserts', 'Boissons']);
    const margherita = menu.categories[0]?.products.find((p) => p.name === 'Margherita');
    expect(margherita?.optionGroups[0]).toMatchObject({
      name: 'Taille',
      required: true,
      min: 1,
      max: 1,
      maxPerOption: 1,
      parentOptionId: null,
    });
    expect(margherita?.optionGroups[1]).toMatchObject({ required: false, max: 3 });
  });

  it("refuse la carte d'un restaurant d'une autre enseigne (cloisonnement)", async () => {
    const res = await app.request(`/v1/tenants/bella/restaurants/${GREEN_RESTO}/menu`);
    expect(res.status).toBe(404);
  });

  it('répond 503 si la carte est indisponible', async () => {
    const down = testApp({
      menus: createMenuCache(
        { fetchMenu: () => Promise.reject(new Error('timeout')) },
        { ttlMs: 1, maxStaleMs: 0 },
      ),
    });
    const res = await down.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'menu_unavailable' } });
  });

  it('prix du mode demandé (?mode=delivery), à emporter par défaut ou si le mode est inconnu', async () => {
    const priced = testApp({
      menus: createMenuCache(
        {
          fetchMenu: () =>
            Promise.resolve({
              restaurantId: BELLA_RESTO,
              categories: [{ id: 'menus', name: 'Menus', position: 1 }],
              products: [
                {
                  id: 'prd1',
                  categoryId: 'menus',
                  name: 'Menu Tasty',
                  description: null,
                  priceCents: cents(900),
                  modePrices: { pickup: cents(900), delivery: cents(1080) },
                  imageUrl: null,
                  available: true,
                  allergens: [],
                  optionGroups: [
                    {
                      id: 'typ1',
                      name: 'Sauces',
                      min: 0,
                      max: 2,
                      maxPerOption: 2,
                      options: [
                        {
                          id: 'ing1-typ1',
                          name: 'Algérienne',
                          priceCents: cents(50),
                          modePrices: { pickup: cents(50), delivery: cents(70) },
                          available: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
        },
        { ttlMs: 60_000, maxStaleMs: 0 },
      ),
    });
    const read = async (query: string) => {
      const res = await priced.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu${query}`);
      const product = menuSchema.parse(await res.json()).categories[0]?.products[0];
      return [product?.priceCents, product?.optionGroups[0]?.options[0]?.priceCents];
    };
    expect(await read('')).toEqual([900, 50]);
    expect(await read('?mode=pickup')).toEqual([900, 50]);
    expect(await read('?mode=delivery')).toEqual([1080, 70]);
    expect(await read('?mode=uber')).toEqual([900, 50]);
    const res = await priced.request(`/v1/tenants/bella/restaurants/${BELLA_RESTO}/menu`);
    expect(
      menuSchema.parse(await res.json()).categories[0]?.products[0]?.optionGroups[0],
    ).toMatchObject({ maxPerOption: 2, parentOptionId: null });
  });
});
