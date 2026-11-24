import { describe, expect, it } from 'vitest';
import { MenuUnavailableError } from '../provider';
import type { Splash360Client } from './client';
import { splash360MenuFixture } from './fixture';
import { createSplash360MenuProvider, toMenu } from './menu';

const BASE = 'https://api.splash360.fr';

describe('toMenu (carte Splash360 → carte interne)', () => {
  const menu = toMenu(splash360MenuFixture, 'resto-1', BASE);

  it('range les groupes visibles par catégorie parente puis par poids, sans groupe vide', () => {
    expect(menu.categories).toEqual([
      { id: 'grp20', name: 'Sodas', position: 1 },
      { id: 'grp11', name: 'Accompagnements', position: 2 },
      { id: 'grp10', name: 'Burgers', position: 3 },
    ]);
  });

  it('traduit prix, disponibilité, description et photo', () => {
    const smoke = menu.products.find((p) => p.id === 'prd87');
    expect(smoke).toMatchObject({
      categoryId: 'grp10',
      name: 'Bills Smoke',
      description: 'Bœuf, cheddar fumé',
      priceCents: 1190,
      available: true,
      imageUrl: 'https://api.splash360.fr/media/prd87.jpg',
      optionGroups: [],
    });
    const classic = menu.products.find((p) => p.id === 'prd85');
    expect(classic).toMatchObject({
      priceCents: 950,
      available: false,
      imageUrl: 'https://cdn.example.test/prd85.png',
    });
  });

  it('ignore les produits masqués, sans prix ou dans un groupe caché', () => {
    const ids = menu.products.map((p) => p.id);
    expect(ids).not.toContain('prd501');
    expect(ids).not.toContain('prd901');
    expect(ids).not.toContain('prd900');
  });

  it('écarte les cadeaux fidélité à 0 € de la caisse, et leur groupe devenu vide', () => {
    expect(menu.products.map((p) => p.id)).not.toContain('prd950');
    expect(menu.categories.map((c) => c.id)).not.toContain('grp40');
  });

  it('ordonne les produits par poids', () => {
    const burgers = menu.products.filter((p) => p.categoryId === 'grp10').map((p) => p.id);
    expect(burgers).toEqual(['prd85', 'prd87']);
  });

  it('refuse une carte illisible', () => {
    expect(() => toMenu({ produits: 'oops' }, 'r', BASE)).toThrow(MenuUnavailableError);
  });
});

describe('createSplash360MenuProvider', () => {
  const client = (getMenus: () => Promise<unknown>): Splash360Client => ({
    getMenus,
    submitCommande: () => Promise.reject(new Error('non utilisé')),
    getCommandeStatus: () => Promise.reject(new Error('non utilisé')),
    submitPaiement: () => Promise.reject(new Error('non utilisé')),
  });
  const source = { restaurantId: 'resto-1', splash360RestaurantId: 'S360-1', live: true };

  it('renvoie la carte traduite', async () => {
    const provider = createSplash360MenuProvider(
      client(() => Promise.resolve(splash360MenuFixture)),
      BASE,
    );
    expect((await provider.fetchMenu(source)).products).toHaveLength(4);
  });

  it("transforme une panne de l'API en carte indisponible", async () => {
    const provider = createSplash360MenuProvider(
      client(() => Promise.reject(new Error('timeout'))),
      BASE,
    );
    await expect(provider.fetchMenu(source)).rejects.toBeInstanceOf(MenuUnavailableError);
  });
});
