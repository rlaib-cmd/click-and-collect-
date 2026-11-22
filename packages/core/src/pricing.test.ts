import { describe, expect, it } from 'vitest';
import type { Menu } from './menu';
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
});
