import type { MenuDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { displayCart } from './display';

const menu: MenuDto = {
  restaurantId: '00000000-0000-4000-8000-000000000001',
  stale: false,
  fetchedAt: '2026-11-22T10:00:00.000Z',
  categories: [
    {
      id: 'c',
      name: 'Pizzas',
      products: [
        {
          id: 'p',
          name: 'Margherita',
          description: null,
          priceCents: 1000,
          imageUrl: null,
          available: true,
          allergens: [],
          featured: false,
          optionGroups: [
            {
              id: 'g',
              name: 'Taille',
              required: true,
              min: 1,
              max: 1,
              maxPerOption: 1,
              parentOptionId: null,
              options: [{ id: 'grande', name: 'Grande', priceCents: 300, available: true }],
            },
          ],
        },
      ],
    },
  ],
};

describe('affichage du panier', () => {
  it('calcule les totaux indicatifs et signale les articles retirés de la carte', () => {
    const { lines, subtotalCents } = displayCart(menu, [
      { key: 'a', productId: 'p', quantity: 2, optionIds: ['grande'], note: null },
      { key: 'b', productId: 'disparu', quantity: 1, optionIds: [], note: null },
    ]);
    expect(lines[0]).toMatchObject({ optionNames: ['Grande'], totalCents: 2600 });
    expect(lines[1]?.product).toBeNull();
    expect(subtotalCents).toBe(2600);
  });

  it('option choisie deux fois : « 2 × » et prix compté deux fois', () => {
    const { lines } = displayCart(menu, [
      { key: 'a', productId: 'p', quantity: 1, optionIds: ['grande', 'grande'], note: null },
    ]);
    expect(lines[0]).toMatchObject({ optionNames: ['2 × Grande'], totalCents: 1600 });
  });
});
