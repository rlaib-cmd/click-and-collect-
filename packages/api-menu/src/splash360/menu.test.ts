import { describe, expect, it } from 'vitest';
import { MenuUnavailableError } from '../provider';
import type { Splash360Client } from './client';
import { splash360MenuFixture } from './fixture';
import { splash360MenuTastyFixture } from './fixture-tasty-v2';
import { splash360MenuV2Fixture } from './fixture-v2';
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
      // Libellé client (`legende`), pas celui du ticket de caisse (`nom`).
      name: 'Bills Smoke 🔥',
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
    getMenusAt: () => Promise.reject(new Error('non utilisé')),
    listSales: () => Promise.reject(new Error('non utilisé')),
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

describe('toMenu — carte v2 réelle (étapes → options, lot 19)', () => {
  const menu = toMenu(splash360MenuV2Fixture, 'resto-cs', BASE);
  const xtra = menu.products.find((p) => p.id === 'prd15348');

  it('traduit les étapes du menu en choix ordonnés avec leurs règles', () => {
    expect(xtra?.optionGroups.map((g) => [g.id, g.name, g.min, g.max])).toEqual([
      ['typ2098', 'Version Bacon', 0, 1],
      ['typ2198', 'Frites', 1, 1],
      ['typ2197', 'Boisson', 1, 1],
    ]);
    const bacon = xtra?.optionGroups[0]?.options[0];
    expect(bacon).toMatchObject({
      id: 'ing15561-typ2098',
      name: 'Bacon de Boeuf',
      priceCents: 150,
    });
    const frites = xtra?.optionGroups[1]?.options.map((o) => [o.name, o.priceCents]);
    expect(frites).toContainEqual(['Frites Cheddar', 100]);
    expect(xtra?.available).toBe(true);
  });

  it('écarte les cadeaux fidélité à 0 € et laisse sans options un produit sans étape', () => {
    expect(menu.products.some((p) => p.priceCents === 0)).toBe(false);
    const simple = menu.products.find((p) => p.id !== 'prd15348');
    expect(simple?.optionGroups).toEqual([]);
  });

  it('rend indisponible un produit dont un choix obligatoire n’a plus d’option disponible', () => {
    const raw = structuredClone(splash360MenuV2Fixture) as unknown as {
      ingredients: { type: string; active: number }[];
    };
    for (const i of raw.ingredients) if (i.type === 'typ2198') i.active = 0;
    const m = toMenu(raw, 'resto-cs', BASE);
    expect(m.products.find((p) => p.id === 'prd15348')?.available).toBe(false);
  });
});

describe('carte v2 réelle Tasty Crousty (exemple Splash360, lot 19)', () => {
  const menu = toMenu(splash360MenuTastyFixture, 'tasty', 'https://api.splash360.fr');
  const crousty = menu.products.find((p) => p.id === 'prd1733');

  it('traduit les étapes en groupes d’options ordonnés, bornes et prix compris', () => {
    expect(crousty?.name).toBe('Crousty Original Sauce Blanche');
    expect(crousty?.priceCents).toBe(900);
    expect(
      crousty?.optionGroups.map((g) => [g.id, g.name, g.min, g.max, g.options.length]),
    ).toEqual([
      ['typ120', 'Sauce crousty', 1, 1, 4],
      ['typ119', 'Suppléments ?', 0, 5, 5],
      ['typ1708', 'Boisson ?', 0, 1, 2],
      ['typ2463', 'Dessert ?', 0, 1, 6],
    ]);
    const supplements = crousty?.optionGroups.find((g) => g.id === 'typ119')?.options;
    expect(supplements?.find((o) => o.id === 'ing1752-typ119')?.priceCents).toBe(200);
  });

  it('affiche la légende client et non le libellé du ticket de caisse', () => {
    const sauces = crousty?.optionGroups.find((g) => g.id === 'typ120')?.options ?? [];
    expect(sauces.map((o) => o.name)).toEqual([
      'Sans sauce',
      'Sauce Sucrée',
      'Sauce Piquante',
      'Sauce Sucrée & Piquante',
    ]);
    expect(sauces.map((o) => o.id)).toContain('ing17726-typ120');
  });

  it('montre indisponibles un dessert inactif et un produit inactif', () => {
    const desserts = crousty?.optionGroups.find((g) => g.id === 'typ2463')?.options ?? [];
    expect(desserts.filter((o) => !o.available).map((o) => o.name)).toEqual(['Tiramisu Nutella']);
    expect(crousty?.available).toBe(true);
    expect(menu.products.find((p) => p.id === 'prd1743')?.available).toBe(false);
  });

  it('ne duplique pas un produit présent aussi dans le catalogue DELIVERY', () => {
    expect(menu.products.filter((p) => p.id === 'prd1733')).toHaveLength(1);
    expect(crousty?.categoryId).toBe('cat27-grp190');
    expect(menu.categories.map((c) => c.id)).not.toContain('cat284-grp190');
  });
});
