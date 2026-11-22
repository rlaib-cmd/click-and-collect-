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
