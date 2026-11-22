import type { MenuDto, ProductDto } from '@splash360/contracts';
import type { CartLine } from '@/cart/cart';

export function findProduct(menu: MenuDto, productId: string): ProductDto | null {
  for (const cat of menu.categories) {
    const p = cat.products.find((x) => x.id === productId);
    if (p) return p;
  }
  return null;
}

export interface DisplayLine {
  readonly line: CartLine;
  readonly product: ProductDto | null;
  readonly optionNames: readonly string[];
  readonly totalCents: number;
}

/**
 * Lignes du panier enrichies pour l'affichage (libellés, prix indicatifs).
 * Le montant payé est toujours celui recalculé par le serveur.
 */
export function displayCart(
  menu: MenuDto,
  lines: readonly CartLine[],
): { lines: DisplayLine[]; subtotalCents: number } {
  const out = lines.map((line) => {
    const product = findProduct(menu, line.productId);
    if (!product) return { line, product: null, optionNames: [], totalCents: 0 };
    const options = product.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => line.optionIds.includes(o.id));
    const unit = product.priceCents + options.reduce((s, o) => s + o.priceCents, 0);
    return {
      line,
      product,
      optionNames: options.map((o) => o.name),
      totalCents: unit * line.quantity,
    };
  });
  return { lines: out, subtotalCents: out.reduce((s, l) => s + l.totalCents, 0) };
}
