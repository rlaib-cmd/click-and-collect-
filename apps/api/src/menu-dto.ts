import type { MenuDto } from '@splash360/contracts';
import type { Menu } from '@splash360/core';

export interface MenuOverride {
  readonly kind: 'category' | 'product';
  readonly itemId: string;
  readonly hidden: boolean;
  readonly position: number | null;
}

/**
 * Carte interne → contrat : réglages locaux appliqués (masquer, ordonner),
 * catégories vides retirées. La carte reste celle de Splash360.
 */
export function toMenuDto(
  menu: Menu,
  restaurantId: string,
  fetchedAt: Date,
  stale: boolean,
  overrides: readonly MenuOverride[] = [],
): MenuDto {
  const find = (kind: MenuOverride['kind'], id: string) =>
    overrides.find((o) => o.kind === kind && o.itemId === id);
  const hidden = (kind: MenuOverride['kind'], id: string) => find(kind, id)?.hidden === true;
  const position = (kind: MenuOverride['kind'], id: string, fallback: number) =>
    find(kind, id)?.position ?? fallback;

  const categories = [...menu.categories]
    .filter((cat) => !hidden('category', cat.id))
    .sort((a, b) => position('category', a.id, a.position) - position('category', b.id, b.position))
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      products: menu.products
        .map((p, index) => ({ p, index }))
        .filter(({ p }) => p.categoryId === cat.id && !hidden('product', p.id))
        .sort((a, b) => position('product', a.p.id, a.index) - position('product', b.p.id, b.index))
        .map(({ p }) => ({
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
