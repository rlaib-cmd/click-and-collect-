import { describe, expect, it } from 'vitest';
import { menuForMode, nestedOptionId, type Menu } from './menu';
import { cents } from './money';
import { priceCart } from './pricing';
import { applyStockOverrides } from './stock';

/** Carte au format traduit de Splash360 : produits `prd…`, options `ing…-typ…`. */
const menu: Menu = {
  restaurantId: 'r1',
  categories: [{ id: 'g1', name: 'Burgers', position: 1 }],
  products: [
    {
      id: 'prd1',
      categoryId: 'g1',
      name: 'Burger',
      description: null,
      priceCents: cents(1000),
      modePrices: { pickup: cents(1000), delivery: cents(1200) },
      imageUrl: null,
      available: true,
      allergens: [],
      optionGroups: [
        {
          id: 'typ10',
          name: 'Sauce',
          min: 1,
          max: 1,
          options: [
            {
              id: 'ing5-typ10',
              name: 'Ketchup',
              priceCents: cents(0),
              modePrices: { pickup: cents(0), delivery: cents(0) },
              available: true,
            },
            { id: 'ing6-typ10', name: 'Mayo', priceCents: cents(50), available: true },
          ],
        },
        {
          id: 'typ20',
          name: 'Menu',
          min: 0,
          max: 1,
          options: [{ id: 'ing7-typ20', name: 'Frites', priceCents: cents(200), available: true }],
        },
        {
          id: nestedOptionId('ing7-typ20', 'typ30'),
          name: 'Taille',
          min: 1,
          max: 1,
          parentOptionId: 'ing7-typ20',
          options: [
            {
              id: nestedOptionId('ing7-typ20', 'ing8-typ30'),
              name: 'Grande',
              priceCents: cents(100),
              available: true,
            },
          ],
        },
      ],
    },
    {
      id: 'prd2',
      categoryId: 'g1',
      name: 'Cookie',
      description: null,
      priceCents: cents(300),
      imageUrl: null,
      available: true,
      allergens: [],
      optionGroups: [],
    },
  ],
};

const none = { available: null, deliveryPriceCents: null };

describe('états reçus de la caisse (webhooks Splash360)', () => {
  it('sans état : la carte est rendue telle quelle', () => {
    expect(applyStockOverrides(menu, [])).toBe(menu);
    expect(applyStockOverrides(menu, [{ itemId: 'prd9', ...none }])).toEqual(menu);
  });

  it('produit hors stock : non commandable ; retour en stock : commandable', () => {
    const out = applyStockOverrides(menu, [
      { itemId: 'prd2', available: false, deliveryPriceCents: null },
    ]);
    expect(out.products[1]?.available).toBe(false);
    const priced = priceCart(out, [{ productId: 'prd2', quantity: 1, optionIds: [] }]);
    expect(priced.ok).toBe(false);
    if (!priced.ok) expect(priced.errors[0]?.code).toBe('product_unavailable');
    const back = applyStockOverrides(
      { ...menu, products: menu.products.map((p) => ({ ...p, available: false })) },
      [{ itemId: 'prd2', available: true, deliveryPriceCents: null }],
    );
    expect(back.products[1]?.available).toBe(true);
  });

  it('option hors stock : non choisissable, y compris dans une étape imbriquée', () => {
    const out = applyStockOverrides(menu, [
      { itemId: 'ing6-typ10', available: false, deliveryPriceCents: null },
      { itemId: 'ing8-typ30', available: false, deliveryPriceCents: null },
    ]);
    const priced = priceCart(out, [{ productId: 'prd1', quantity: 1, optionIds: ['ing6-typ10'] }]);
    expect(priced.ok).toBe(false);
    if (!priced.ok) expect(priced.errors[0]?.code).toBe('option_unavailable');
    const nested = out.products[0]?.optionGroups[2]?.options[0];
    expect(nested?.available).toBe(false);
    // Le produit reste commandable : l'étape imbriquée n'est exigée que si « Frites » est choisie.
    expect(out.products[0]?.available).toBe(true);
  });

  it('dernière option d’un choix obligatoire hors stock : produit indisponible', () => {
    const out = applyStockOverrides(menu, [
      { itemId: 'ing5-typ10', available: false, deliveryPriceCents: null },
      { itemId: 'ing6-typ10', available: false, deliveryPriceCents: null },
    ]);
    expect(out.products[0]?.available).toBe(false);
  });

  it('prix de livraison propre : livraison seulement, produit et option', () => {
    const out = applyStockOverrides(menu, [
      { itemId: 'prd1', available: null, deliveryPriceCents: 1350 },
      { itemId: 'ing6-typ10', available: null, deliveryPriceCents: 80 },
    ]);
    const lines = [{ productId: 'prd1', quantity: 2, optionIds: ['ing6-typ10'] }];
    const delivery = priceCart(menuForMode(out, 'delivery'), lines);
    const pickup = priceCart(menuForMode(out, 'pickup'), lines);
    expect(delivery.ok && delivery.subtotalCents).toBe(2 * (1350 + 80));
    expect(pickup.ok && pickup.subtotalCents).toBe(2 * (1000 + 50));
    // Disponibilité inchangée quand seul le prix est reçu.
    expect(out.products[0]?.available).toBe(true);
  });
});
