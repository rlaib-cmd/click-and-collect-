import { cents, type Menu } from '@splash360/core';
import { describe, expect, it } from 'vitest';
import { toMenuDto } from './menu-dto';

const product = (id: string, categoryId: string) => ({
  id,
  categoryId,
  name: id,
  description: null,
  priceCents: cents(100),
  imageUrl: null,
  available: true,
  allergens: [],
  optionGroups: [],
});

const menu: Menu = {
  restaurantId: 'r',
  categories: [
    { id: 'pizzas', name: 'Pizzas', position: 1 },
    { id: 'desserts', name: 'Desserts', position: 2 },
    { id: 'boissons', name: 'Boissons', position: 3 },
  ],
  products: [
    product('a', 'pizzas'),
    product('b', 'pizzas'),
    product('c', 'pizzas'),
    product('d', 'desserts'),
    product('e', 'boissons'),
  ],
};

describe('réglages locaux de la carte', () => {
  it('masque et réordonne catégories et produits, retire les catégories vides', () => {
    const dto = toMenuDto(menu, '00000000-0000-4000-8000-000000000001', new Date(0), false, [
      { kind: 'product', itemId: 'b', hidden: true, position: null },
      { kind: 'product', itemId: 'c', hidden: false, position: -1 },
      { kind: 'product', itemId: 'd', hidden: true, position: null },
      { kind: 'category', itemId: 'boissons', hidden: false, position: 0 },
    ]);
    expect(dto.categories.map((c) => c.id)).toEqual(['boissons', 'pizzas']);
    expect(dto.categories[1]?.products.map((p) => p.id)).toEqual(['c', 'a']);
  });
});
