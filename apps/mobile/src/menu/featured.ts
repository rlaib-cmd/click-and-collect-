import type { MenuDto, ProductDto, RestaurantDto } from '@splash360/contracts';

/** Restaurant dont l'accueil montre la carte : le premier ouvert à la commande, sinon le premier. */
export function homeRestaurant(restaurants: readonly RestaurantDto[] | undefined): string | null {
  if (!restaurants || restaurants.length === 0) return null;
  return (restaurants.find((r) => r.status === 'active') ?? restaurants[0])?.id ?? null;
}

/** Produits mis en avant par la marque (« En ce moment »), disponibles, sans doublon. */
export function featuredProducts(menu: MenuDto | undefined, max = 10): ProductDto[] {
  if (!menu) return [];
  const seen = new Set<string>();
  const out: ProductDto[] = [];
  for (const cat of menu.categories)
    for (const p of cat.products)
      if (p.featured && p.available && !seen.has(p.id) && out.length < max) {
        seen.add(p.id);
        out.push(p);
      }
  return out;
}
