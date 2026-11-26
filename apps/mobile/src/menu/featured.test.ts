import type { MenuDto, ProductDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import { featuredProducts, homeRestaurant } from './featured';

const product = (id: string, featured: boolean, available = true): ProductDto => ({
  id,
  name: id,
  description: null,
  priceCents: 590,
  imageUrl: null,
  available,
  allergens: [],
  optionGroups: [],
  featured,
  promo: null,
});

const menu: MenuDto = {
  restaurantId: '7cb95cb9-a290-46be-95b5-7720ffbf27b2',
  stale: false,
  fetchedAt: '2026-11-25T10:00:00.000Z',
  categories: [
    { id: 'a', name: 'Burgers', products: [product('smash', true), product('classic', false)] },
    { id: 'b', name: 'Sides', products: [product('frites', true, false), product('wings', true)] },
    { id: 'c', name: 'Bon plan', products: [product('smash', true)] },
  ],
};

describe('mise en avant sur l’accueil', () => {
  it('garde les produits mis en avant et disponibles, une seule fois, dans l’ordre de la carte', () => {
    expect(featuredProducts(menu).map((p) => p.id)).toEqual(['smash', 'wings']);
    expect(featuredProducts(menu, 1).map((p) => p.id)).toEqual(['smash']);
    expect(featuredProducts(undefined)).toEqual([]);
  });

  it('prend le premier restaurant ouvert à la commande', () => {
    const r = (id: string, status: 'active' | 'paused') => ({
      id,
      name: id,
      addressLine: '',
      postalCode: '',
      city: '',
      status,
    });
    expect(homeRestaurant([r('x', 'paused'), r('y', 'active')])).toBe('y');
    expect(homeRestaurant([r('x', 'paused')])).toBe('x');
    expect(homeRestaurant([])).toBeNull();
    expect(homeRestaurant(undefined)).toBeNull();
  });
});
