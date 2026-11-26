import { describe, expect, it } from 'vitest';
import { menuForMode, nestedOptionId, splitOptionId, type Menu } from './menu';
import { cents } from './money';
import { priceCart } from './pricing';

const menu: Menu = {
  restaurantId: 'r1',
  categories: [{ id: 'pizzas', name: 'Pizzas', position: 1 }],
  products: [
    {
      id: 'margherita',
      categoryId: 'pizzas',
      name: 'Margherita',
      description: null,
      priceCents: cents(1050),
      imageUrl: null,
      available: true,
      allergens: ['gluten', 'lait'],
      optionGroups: [
        {
          id: 'taille',
          name: 'Taille',
          min: 1,
          max: 1,
          options: [
            { id: 'normale', name: 'Normale', priceCents: cents(0), available: true },
            { id: 'grande', name: 'Grande', priceCents: cents(300), available: true },
          ],
        },
        {
          id: 'supplements',
          name: 'Suppléments',
          min: 0,
          max: 2,
          options: [
            { id: 'burrata', name: 'Burrata', priceCents: cents(350), available: true },
            { id: 'jambon', name: 'Jambon', priceCents: cents(200), available: true },
            { id: 'truffe', name: 'Truffe', priceCents: cents(500), available: false },
          ],
        },
      ],
    },
    {
      id: 'tiramisu',
      categoryId: 'pizzas',
      name: 'Tiramisu',
      description: null,
      priceCents: cents(650),
      imageUrl: null,
      available: false,
      allergens: [],
      optionGroups: [],
    },
  ],
};

describe('calcul du panier', () => {
  it('additionne prix de base, suppléments et quantités', () => {
    const result = priceCart(menu, [
      {
        productId: 'margherita',
        quantity: 2,
        optionIds: ['burrata', 'grande'],
        note: '  bien cuite ',
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [line] = result.lines;
    expect(line?.unitPriceCents).toBe(1050 + 300 + 350);
    expect(line?.totalCents).toBe(3400);
    expect(line?.note).toBe('bien cuite');
    // Options dans l'ordre de la carte, libellés figés.
    expect(line?.options.map((o) => o.name)).toEqual(['Grande', 'Burrata']);
    expect(result.subtotalCents).toBe(3400);
  });

  it('refuse un panier vide', () => {
    expect(priceCart(menu, [])).toEqual({ ok: false, errors: [{ code: 'empty_cart' }] });
  });

  it('exige les options obligatoires et respecte le maximum', () => {
    const missing = priceCart(menu, [{ productId: 'margherita', quantity: 1, optionIds: [] }]);
    expect(missing).toMatchObject({
      ok: false,
      errors: [{ code: 'too_few_options', groupId: 'taille' }],
    });

    const tooMany = priceCart(menu, [
      { productId: 'margherita', quantity: 1, optionIds: ['normale', 'grande'] },
    ]);
    expect(tooMany).toMatchObject({
      ok: false,
      errors: [{ code: 'too_many_options', groupId: 'taille' }],
    });
  });

  it('refuse produits et options inconnus, indisponibles ou en double', () => {
    const result = priceCart(menu, [
      { productId: 'inconnu', quantity: 1, optionIds: [] },
      { productId: 'tiramisu', quantity: 1, optionIds: [] },
      {
        productId: 'margherita',
        quantity: 1,
        optionIds: ['normale', 'truffe', 'xxx', 'jambon', 'jambon'],
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => [e.line, e.code])).toEqual([
      [0, 'unknown_product'],
      [1, 'product_unavailable'],
      [2, 'option_unavailable'],
      [2, 'unknown_option'],
      [2, 'duplicate_option'],
    ]);
  });

  it('refuse les quantités hors 1..99 et non entières', () => {
    for (const quantity of [0, -1, 1.5, 100]) {
      const r = priceCart(menu, [{ productId: 'margherita', quantity, optionIds: ['normale'] }]);
      expect(r).toMatchObject({ ok: false, errors: [{ code: 'invalid_quantity' }] });
    }
  });

  it('refuse une note trop longue', () => {
    const r = priceCart(menu, [
      { productId: 'margherita', quantity: 1, optionIds: ['normale'], note: 'x'.repeat(201) },
    ]);
    expect(r).toMatchObject({ ok: false, errors: [{ code: 'note_too_long' }] });
  });

  describe('carte Splash360 : prix par mode, même option deux fois, étapes imbriquées', () => {
    // Formule : boisson au choix (prix par mode), sauces (deux fois la même possible),
    // accompagnement « Frites » qui ouvre une étape imbriquée (sel).
    const formule: Menu = {
      restaurantId: 'r1',
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
              id: 'typ-sauce',
              name: 'Sauces',
              min: 1,
              max: 2,
              maxPerOption: 2,
              options: [
                {
                  id: 'ing1-typ-sauce',
                  name: 'Algérienne',
                  priceCents: cents(50),
                  modePrices: { pickup: cents(50), delivery: cents(70) },
                  available: true,
                },
                { id: 'ing2-typ-sauce', name: 'Ketchup', priceCents: cents(0), available: true },
              ],
            },
            {
              id: 'typ-acc',
              name: 'Accompagnement',
              min: 0,
              max: 1,
              options: [
                {
                  id: 'ing3-typ-acc',
                  name: 'Frites',
                  priceCents: cents(150),
                  modePrices: { pickup: cents(150), delivery: cents(199) },
                  available: true,
                },
              ],
            },
            {
              id: 'ing3-typ-acc>typ-sel',
              name: 'Sel',
              min: 1,
              max: 1,
              parentOptionId: 'ing3-typ-acc',
              options: [
                {
                  id: 'ing3-typ-acc>ing9-typ-sel',
                  name: 'Salées',
                  priceCents: cents(0),
                  available: true,
                },
              ],
            },
          ],
        },
      ],
    };

    it('prix du mode : à emporter (entrée 1) ou livraison (entrée 2), options comprises', () => {
      const line = {
        productId: 'prd1',
        quantity: 2,
        optionIds: ['ing1-typ-sauce', 'ing3-typ-acc', 'ing3-typ-acc>ing9-typ-sel'],
      };
      const pickup = priceCart(menuForMode(formule, 'pickup'), [line]);
      const delivery = priceCart(menuForMode(formule, 'delivery'), [line]);
      // (900 + 50 + 150) × 2 et (1080 + 70 + 199) × 2.
      expect(pickup).toMatchObject({ ok: true, subtotalCents: 2200 });
      expect(delivery).toMatchObject({ ok: true, subtotalCents: 2698 });
      // Sans prix par mode : `priceCents` (prix_c) pour tous les modes.
      expect(priceCart(formule, [line])).toMatchObject({ ok: true, subtotalCents: 2200 });
    });

    it('même option choisie deux fois : deux unités, prix × 2, dans la limite du groupe', () => {
      const r = priceCart(menuForMode(formule, 'delivery'), [
        { productId: 'prd1', quantity: 1, optionIds: ['ing1-typ-sauce', 'ing1-typ-sauce'] },
      ]);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.lines[0]?.options.map((o) => o.optionId)).toEqual([
        'ing1-typ-sauce',
        'ing1-typ-sauce',
      ]);
      expect(r.lines[0]?.unitPriceCents).toBe(1080 + 70 + 70);
      const three = priceCart(formule, [
        {
          productId: 'prd1',
          quantity: 1,
          optionIds: ['ing1-typ-sauce', 'ing1-typ-sauce', 'ing1-typ-sauce'],
        },
      ]);
      expect(three).toMatchObject({ ok: false, errors: [{ code: 'duplicate_option' }] });
      const tooMany = priceCart(formule, [
        {
          productId: 'prd1',
          quantity: 1,
          optionIds: ['ing1-typ-sauce', 'ing1-typ-sauce', 'ing2-typ-sauce'],
        },
      ]);
      expect(tooMany).toMatchObject({ ok: false, errors: [{ code: 'too_many_options' }] });
    });

    it('étape imbriquée : obligatoire si son option parente est choisie, refusée sinon', () => {
      const missing = priceCart(formule, [
        { productId: 'prd1', quantity: 1, optionIds: ['ing2-typ-sauce', 'ing3-typ-acc'] },
      ]);
      expect(missing).toMatchObject({
        ok: false,
        errors: [{ code: 'too_few_options', groupId: 'ing3-typ-acc>typ-sel' }],
      });
      const orphan = priceCart(formule, [
        {
          productId: 'prd1',
          quantity: 1,
          optionIds: ['ing2-typ-sauce', 'ing3-typ-acc>ing9-typ-sel'],
        },
      ]);
      expect(orphan).toMatchObject({
        ok: false,
        errors: [{ code: 'unknown_option', optionId: 'ing3-typ-acc>ing9-typ-sel' }],
      });
      // Sans l'option parente, l'étape imbriquée n'est pas exigée.
      expect(
        priceCart(formule, [{ productId: 'prd1', quantity: 1, optionIds: ['ing2-typ-sauce'] }]),
      ).toMatchObject({ ok: true, subtotalCents: 900 });
    });

    it('identifiants d’étape imbriquée : parent retrouvé', () => {
      expect(nestedOptionId('ing3-typ-acc', 'ing9-typ-sel')).toBe('ing3-typ-acc>ing9-typ-sel');
      expect(splitOptionId('ing3-typ-acc>ing9-typ-sel')).toEqual({
        parentId: 'ing3-typ-acc',
        optionId: 'ing9-typ-sel',
      });
      expect(splitOptionId('ing15407-typ2075')).toEqual({
        parentId: null,
        optionId: 'ing15407-typ2075',
      });
    });
  });
});
