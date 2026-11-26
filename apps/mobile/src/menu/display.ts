import type { MenuDto, ProductDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
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
    const options = product.optionGroups.flatMap((g) => g.options);
    // Une option choisie deux fois apparaît deux fois dans `optionIds` : « 2 × Algérienne ».
    const counts = new Map<string, number>();
    for (const id of line.optionIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const chosen = options.filter((o) => counts.has(o.id));
    const unit =
      product.priceCents + chosen.reduce((s, o) => s + o.priceCents * (counts.get(o.id) ?? 0), 0);
    return {
      line,
      product,
      optionNames: chosen.map((o) => {
        const n = counts.get(o.id) ?? 1;
        return n > 1 ? messages.product.optionTimes(n, o.name) : o.name;
      }),
      totalCents: unit * line.quantity,
    };
  });
  return { lines: out, subtotalCents: out.reduce((s, l) => s + l.totalCents, 0) };
}
