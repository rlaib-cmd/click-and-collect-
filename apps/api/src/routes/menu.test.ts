import { menuSchema, restaurantListSchema } from '@splash360/contracts';
import { createMenuCache } from '@splash360/api-menu';
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
});
