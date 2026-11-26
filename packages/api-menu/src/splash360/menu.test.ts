import { describe, expect, it } from 'vitest';
import { MenuUnavailableError } from '../provider';
import type { Splash360Client } from './client';
import { splash360MenuFixture } from './fixture';
import { splash360MenuTastyFixture } from './fixture-tasty-v2';
import { splash360MenuV2Fixture } from './fixture-v2';
import { createSplash360MenuProvider, parseRuleValue, toMenu } from './menu';

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

describe('prix par mode, même option deux fois et étapes imbriquées (réponses du 26/11)', () => {
  const ttc = (...v: number[]) => v.map((t) => ({ ht: Math.round(t / 1.1), ttc: t, tva: 0 }));
  const raw = {
    categories: [{ categorie_id: 'cat1', nom: 'Carte' }],
    groupes: [{ groupe_id: 'grp1', categorie: 'cat1', nom: 'Menus', weight: 1 }],
    types: [
      { type_id: 'typ2076', nom: 'Sauces' },
      { type_id: 'typ2079', nom: 'Accompagnement' },
      { type_id: 'typ2081', nom: 'Sel' },
    ],
    ingredients: [
      {
        ingredient_id: 'ing15412-typ2076',
        type: 'typ2076',
        nom: 'Algérienne',
        supplement_c: 50,
        supplementArray_c: ttc(50, 50, 50, 99, 99),
      },
      { ingredient_id: 'ing15413-typ2076', type: 'typ2076', nom: 'Ketchup', supplement_c: 0 },
      {
        ingredient_id: 'ing15278-typ2079',
        type: 'typ2079',
        nom: 'Frites',
        supplement_c: 150,
        // Tableau trop court : la livraison reprend `supplement_c`.
        supplementArray_c: ttc(150, 160),
      },
      { ingredient_id: 'ing15300-typ2081', type: 'typ2081', nom: 'Salées', supplement_c: 0 },
    ],
    produits: [
      {
        produit_id: 'prd15156',
        groupe: 'grp1',
        nom: 'Menu',
        prix_c: 600,
        prixArray_c: ttc(600, 600, 690, 850, 810),
      },
      { produit_id: 'prd2', groupe: 'grp1', nom: 'Sans tableau', prix_c: 450 },
    ],
    steps: [
      {
        produit: 'prd15156',
        regles: [
          { type: 'typ2076', min: 1, max: 2, max_par_produit: 2, supplement_c: 0 },
          { type: 'typ2079', min: 0, max: 1, max_par_produit: 1, supplement_c: 0 },
        ],
      },
      {
        produit: 'ing15278-typ2079',
        regles: [{ type: 'typ2081', min: 1, max: 1, max_par_produit: 1, supplement_c: 0 }],
      },
    ],
  };
  const menu = toMenu(raw, 'r', 'https://api.splash360.fr');
  const product = menu.products.find((p) => p.id === 'prd15156');

  it('prixArray_c : à emporter = entrée 1, livraison = entrée 2 ; prix_c sinon', () => {
    expect(product?.priceCents).toBe(600);
    expect(product?.modePrices).toEqual({ pickup: 600, delivery: 690 });
    expect(menu.products.find((p) => p.id === 'prd2')?.modePrices).toEqual({
      pickup: 450,
      delivery: 450,
    });
    const sauces = product?.optionGroups.find((g) => g.id === 'typ2076');
    expect(sauces?.options[0]?.modePrices).toEqual({ pickup: 50, delivery: 50 });
    const frites = product?.optionGroups.find((g) => g.id === 'typ2079')?.options[0];
    expect(frites?.modePrices).toEqual({ pickup: 160, delivery: 150 });
  });

  it('max_par_produit : même option jusqu’à deux fois', () => {
    const sauces = product?.optionGroups.find((g) => g.id === 'typ2076');
    expect(sauces).toMatchObject({ min: 1, max: 2, maxPerOption: 2 });
    expect(product?.optionGroups.find((g) => g.id === 'typ2079')?.maxPerOption).toBeUndefined();
  });

  it('étape imbriquée : groupe rattaché à l’option parente, identifiants préfixés', () => {
    expect(product?.optionGroups.map((g) => [g.id, g.parentOptionId ?? null])).toEqual([
      ['typ2076', null],
      ['typ2079', null],
      ['ing15278-typ2079>typ2081', 'ing15278-typ2079'],
    ]);
    const nested = product?.optionGroups[2];
    expect(nested?.options.map((o) => o.id)).toEqual(['ing15278-typ2079>ing15300-typ2081']);
    // Étape imbriquée obligatoire, mais seulement si « Frites » est choisi : produit disponible.
    expect(product?.available).toBe(true);
  });

  it('carte réelle Tasty : prix de livraison lu dans prixArray_c', () => {
    const tasty = toMenu(splash360MenuTastyFixture, 'tasty', BASE);
    expect(tasty.products.find((p) => p.id === 'prd1733')?.modePrices).toEqual({
      pickup: 900,
      delivery: 1080,
    });
  });
});

describe('promotions de catalogue (reglescatalogue, lot 24)', () => {
  // Extrait réel (carte Chicken Street Siège du 25/11) : une copie de chaque règle par mode.
  const real = [
    {
      reglecatalogue_id: 'modifier4_surplace',
      type: 'catalogue',
      mode: 'surplace',
      start: 1780963200000,
      end: 4936723199000,
      min: 4,
      max: 4,
      quantite: 0,
      produits: ['prd15178', 'prd15177', 'prd15176', 'prd15170', 'prd15169'],
      selection: 'all',
      valeur: '100%',
      operation: -1,
      nom: '3 acheter = 1',
      taux: 0,
    },
    {
      reglecatalogue_id: 'modifier4_emporter',
      type: 'catalogue',
      mode: 'emporter',
      start: 1780963200000,
      end: 4936723199000,
      min: 4,
      max: 4,
      quantite: 0,
      produits: ['prd15178', 'prd15177', 'prd15176', 'prd15170', 'prd15169'],
      selection: 'all',
      valeur: '100%',
      operation: -1,
      nom: '3 acheter = 1',
      taux: 0,
    },
  ];

  it('traduit les règles reçues, dans l’ordre, toutes copies comprises', () => {
    const menu = toMenu({ ...splash360MenuFixture, reglescatalogue: real }, 'r', BASE);
    expect(menu.catalogRules).toEqual([
      expect.objectContaining({ id: 'modifier4_surplace', mode: 'surplace' }),
      {
        id: 'modifier4_emporter',
        name: '3 acheter = 1',
        mode: 'emporter',
        startsAt: 1780963200000,
        endsAt: 4936723199000,
        min: 4,
        max: 4,
        quantity: 0,
        productIds: ['prd15178', 'prd15177', 'prd15176', 'prd15170', 'prd15169'],
        selection: 'all',
        value: { kind: 'percent', hundredths: 10_000 },
        valueLabel: '100%',
        operation: -1,
        vatRate: 0,
      },
    ]);
  });

  it('sans règle : pas de champ ; end = 0 : sans fin ; selection « one »', () => {
    expect(toMenu(splash360MenuFixture, 'r', BASE).catalogRules).toBeUndefined();
    const menu = toMenu(
      {
        ...splash360MenuFixture,
        reglescatalogue: [
          { ...real[1], end: 0, selection: 'one', valeur: '3.9€', operation: '1', produits: [] },
        ],
      },
      'r',
      BASE,
    );
    expect(menu.catalogRules?.[0]).toMatchObject({
      endsAt: null,
      selection: 'one',
      value: { kind: 'fixed', cents: 390 },
      valueLabel: '3.9€',
      operation: 1,
    });
  });

  it('tolérante : règle illisible écartée, champs inconnus ignorés, carte gardée', () => {
    const menu = toMenu(
      {
        ...splash360MenuFixture,
        reglescatalogue: [
          'pas une règle',
          { ...real[1], reglecatalogue_id: 'mode', mode: 'uber' },
          { ...real[1], reglecatalogue_id: 'valeur', valeur: 'gratuit' },
          { ...real[1], reglecatalogue_id: 'op', operation: 0 },
          { ...real[1], reglecatalogue_id: 'ok', inconnu: { x: 1 }, min: 'x' },
        ],
      },
      'r',
      BASE,
    );
    expect(menu.catalogRules?.map((r) => [r.id, r.min])).toEqual([['ok', 0]]);
    expect(
      toMenu({ ...splash360MenuFixture, reglescatalogue: 'x' }, 'r', BASE).products.length,
    ).toBeGreaterThan(0);
  });

  it('valeur : pourcentage ou euros (point décimal, virgule tolérée)', () => {
    expect(parseRuleValue('100%')).toEqual({ kind: 'percent', hundredths: 10_000 });
    expect(parseRuleValue('10.5 %')).toEqual({ kind: 'percent', hundredths: 1050 });
    expect(parseRuleValue('3,9€')).toEqual({ kind: 'fixed', cents: 390 });
    expect(parseRuleValue('5€')).toEqual({ kind: 'fixed', cents: 500 });
    expect(parseRuleValue('150%')).toEqual({ kind: 'percent', hundredths: 10_000 });
    expect(parseRuleValue('-5€')).toBeNull();
    expect(parseRuleValue(undefined)).toBeNull();
  });
});
