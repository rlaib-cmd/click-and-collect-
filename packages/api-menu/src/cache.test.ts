import type { Menu } from '@splash360/core';
import { describe, expect, it, vi } from 'vitest';
import { createMenuCache } from './cache';
import { createDemoMenuProvider } from './demo';
import { MenuUnavailableError, type MenuProvider } from './provider';

const source = { restaurantId: 'r1', splash360RestaurantId: 'S360-R-BELLA-1' };
const menu: Menu = { restaurantId: 'r1', categories: [], products: [] };

function clock(start = 0) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe('cache de carte', () => {
  it('ne rappelle pas l’API pendant la durée de fraîcheur', async () => {
    const fetchMenu = vi.fn().mockResolvedValue(menu);
    const c = clock();
    const cache = createMenuCache(
      { fetchMenu },
      { ttlMs: 60_000, maxStaleMs: 3_600_000, now: c.now },
    );
    await cache.get(source);
    c.advance(30_000);
    await cache.get(source);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
    c.advance(31_000);
    await cache.get(source);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
  });

  it('« Actualiser » force un nouvel appel', async () => {
    const fetchMenu = vi.fn().mockResolvedValue(menu);
    const cache = createMenuCache({ fetchMenu }, { ttlMs: 60_000, maxStaleMs: 0 });
    await cache.get(source);
    cache.invalidate('r1');
    await cache.get(source);
    expect(fetchMenu).toHaveBeenCalledTimes(2);
  });

  it('regroupe les appels simultanés', async () => {
    const fetchMenu = vi.fn().mockResolvedValue(menu);
    const cache = createMenuCache({ fetchMenu }, { ttlMs: 60_000, maxStaleMs: 0 });
    await Promise.all([cache.get(source), cache.get(source), cache.get(source)]);
    expect(fetchMenu).toHaveBeenCalledTimes(1);
  });

  it('sert la dernière carte connue si l’API tombe, puis bloque au-delà de la limite', async () => {
    const c = clock();
    const provider: MenuProvider = {
      fetchMenu: vi.fn().mockResolvedValueOnce(menu).mockRejectedValue(new Error('500')),
    };
    const cache = createMenuCache(provider, { ttlMs: 60_000, maxStaleMs: 600_000, now: c.now });
    await cache.get(source);
    c.advance(120_000);
    expect(await cache.get(source)).toMatchObject({ stale: true, menu });
    c.advance(600_000);
    await expect(cache.get(source)).rejects.toBeInstanceOf(MenuUnavailableError);
  });

  it('échoue sans carte connue', async () => {
    const cache = createMenuCache(
      { fetchMenu: () => Promise.reject(new Error('timeout')) },
      { ttlMs: 60_000, maxStaleMs: 600_000 },
    );
    await expect(cache.get(source)).rejects.toBeInstanceOf(MenuUnavailableError);
  });
});

describe('cartes de démonstration', () => {
  it('servent la carte du restaurant demandé avec son identifiant interne', async () => {
    const m = await createDemoMenuProvider().fetchMenu(source);
    expect(m.restaurantId).toBe('r1');
    expect(m.products.some((p) => p.name === 'Margherita')).toBe(true);
  });

  it('refusent un restaurant inconnu', async () => {
    await expect(
      createDemoMenuProvider().fetchMenu({ restaurantId: 'x', splash360RestaurantId: 'inconnu' }),
    ).rejects.toBeInstanceOf(MenuUnavailableError);
  });
});

describe('carte de démonstration Chicken Street', () => {
  it('se calcule : menu avec tenders 6 pièces, potatoes et sauce Cheezy', async () => {
    const { priceCart } = await import('@splash360/core');
    const menu = await createDemoMenuProvider().fetchMenu({
      restaurantId: 'cs',
      splash360RestaurantId: 'S360-R-CHICKEN-1',
    });
    const result = priceCart(menu, [
      {
        productId: 'p-menu-tenders',
        quantity: 2,
        optionIds: ['opt-tenders-6', 'opt-sauce-cheezy', 'opt-potatoes', 'opt-ice-tea'],
      },
    ]);
    // (10,50 + 2,50 + 0,50 + 0,50) × 2 = 28,00 €
    expect(result).toMatchObject({ ok: true, subtotalCents: 2800 });
    expect(
      priceCart(menu, [{ productId: 'p-menu-tenders', quantity: 1, optionIds: ['opt-tenders-4'] }])
        .ok,
    ).toBe(false);
  });
});

describe('carte de démonstration Bills Burger', () => {
  it('se calcule : Bills Original en menu, viande obligatoire', async () => {
    const { priceCart } = await import('@splash360/core');
    const menu = await createDemoMenuProvider().fetchMenu({
      restaurantId: 'bb',
      splash360RestaurantId: 'S360-R-BILLS-1',
    });
    // (10,90 + 4,00 menu) × 2 = 29,80 €
    expect(
      priceCart(menu, [
        { productId: 'bb-original', quantity: 2, optionIds: ['bb-opt-crispy', 'bb-opt-menu'] },
      ]),
    ).toMatchObject({ ok: true, subtotalCents: 2980 });
    expect(
      priceCart(menu, [{ productId: 'bb-original', quantity: 1, optionIds: ['bb-opt-menu'] }]).ok,
    ).toBe(false);
    // Chaque produit a une photo du site de l'enseigne (ou de son stockage), en https.
    for (const p of menu.products) {
      expect(p.imageUrl).toMatch(
        /^https:\/\/(bills-burger\.fr|storage\.googleapis\.com\/bills-burger)\//,
      );
    }
  });
});
