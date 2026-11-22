import type { MenuDto } from '@splash360/contracts';
import type { Menu } from '@splash360/core';

/** Carte interne → contrat : catégories triées, catégories vides retirées. */
export function toMenuDto(
  menu: Menu,
  restaurantId: string,
  fetchedAt: Date,
  stale: boolean,
): MenuDto {
  const categories = [...menu.categories]
    .sort((a, b) => a.position - b.position)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      products: menu.products
        .filter((p) => p.categoryId === cat.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          imageUrl: p.imageUrl,
          available: p.available,
          allergens: [...p.allergens],
          optionGroups: p.optionGroups.map((g) => ({
            id: g.id,
            name: g.name,
            required: g.min > 0,
            min: g.min,
            max: g.max,
            options: g.options.map((o) => ({ ...o })),
          })),
        })),
    }))
    .filter((cat) => cat.products.length > 0);
  return { restaurantId, stale, fetchedAt: fetchedAt.toISOString(), categories };
}
