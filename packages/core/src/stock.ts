import type { Menu, MenuOption, OptionGroup } from './menu';
import { splitOptionId } from './menu';
import { cents } from './money';

/**
 * État reçu de la caisse pour un article publié (webhooks Splash360, lot 23, ADR 0029) :
 * `prd…` (produit vendu seul), `ing…-typ…` (ingrédient d'une personnalisation) ou un SKU.
 */
export interface StockOverride {
  readonly itemId: string;
  /** null : aucun état reçu, la carte fait foi. */
  readonly available: boolean | null;
  /** Prix de livraison propre (TTC, centimes) ; null : prix de livraison de la carte. */
  readonly deliveryPriceCents: number | null;
}

/** Un choix obligatoire sans assez d'options disponibles rend le produit indisponible. */
function satisfiable(g: OptionGroup): boolean {
  return g.options.filter((o) => o.available).length >= g.min;
}

/**
 * Carte de l'API menu complétée des états reçus de la caisse :
 * - disponibilité : l'état reçu remplace celui de la carte, pour le produit (son identifiant) ou
 *   l'option (identifiant d'ingrédient, aussi dans une étape imbriquée `parent>ing…`) ; un produit
 *   dont un choix obligatoire n'a plus assez d'options disponibles devient indisponible ;
 * - prix de livraison propre : remplace le prix du mode « livraison » du produit ou de l'option
 *   (`modePrices.delivery`), à emporter inchangé.
 * Fonction pure : rien n'est modifié en place.
 */
export function applyStockOverrides(menu: Menu, overrides: readonly StockOverride[]): Menu {
  if (overrides.length === 0) return menu;
  const byId = new Map(overrides.map((o) => [o.itemId, o]));
  const option = (o: MenuOption): MenuOption => {
    const state = byId.get(splitOptionId(o.id).optionId);
    if (!state) return o;
    const price = state.deliveryPriceCents;
    return {
      ...o,
      available: state.available ?? o.available,
      ...(price === null
        ? {}
        : { modePrices: { pickup: o.modePrices?.pickup ?? o.priceCents, delivery: cents(price) } }),
    };
  };
  return {
    ...menu,
    products: menu.products.map((p) => {
      const state = byId.get(p.id);
      const optionGroups = p.optionGroups.map((g) => ({ ...g, options: g.options.map(option) }));
      const changedOptions = optionGroups.some((g, i) =>
        g.options.some((o, j) => o !== p.optionGroups[i]?.options[j]),
      );
      if (!state && !changedOptions) return p;
      const price = state?.deliveryPriceCents ?? null;
      const available =
        (state?.available ?? p.available) &&
        optionGroups.filter((g) => !g.parentOptionId).every(satisfiable);
      return {
        ...p,
        available,
        optionGroups,
        ...(price === null
          ? {}
          : {
              modePrices: { pickup: p.modePrices?.pickup ?? p.priceCents, delivery: cents(price) },
            }),
      };
    }),
  };
}
