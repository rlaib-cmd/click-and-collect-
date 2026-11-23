import type { LoyaltyRewardDto, ProductDto } from '@splash360/contracts';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useMenu, useRestaurants } from '@/api/hooks';
import type { CartAction, CartState } from '@/cart/cart';

/**
 * Carte servant à illustrer les cadeaux : celle du restaurant du panier, sinon du premier
 * restaurant de l'enseigne. Les cadeaux sont des produits de la carte Splash360.
 */
export function useRewardCatalog(cart: Pick<CartState, 'restaurantId'>) {
  const restaurants = useRestaurants();
  const restaurantId = cart.restaurantId ?? restaurants.data?.[0]?.id ?? '';
  const menu = useMenu(restaurantId);
  const products = useMemo(
    () =>
      new Map(
        (menu.data?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p] as const)),
      ),
    [menu.data],
  );
  return { restaurantId, products };
}

/** Produits d'un palier présents sur la carte, dans l'ordre du palier. */
export function tierProducts(
  reward: Pick<LoyaltyRewardDto, 'productIds'>,
  products: ReadonlyMap<string, ProductDto>,
): ProductDto[] {
  return reward.productIds.flatMap((id) => {
    const p = products.get(id);
    return p ? [p] : [];
  });
}

/** Un produit sans choix obligatoire s'ajoute directement ; sinon on ouvre sa fiche. */
export function needsChoice(product: ProductDto): boolean {
  return product.optionGroups.some((g) => g.required || g.min > 0);
}

/**
 * Pont « cadeau → carte » (lot 11) : ajoute le produit offert au panier et retient le cadeau,
 * ou ouvre la fiche produit en mode cadeau s'il faut choisir des options.
 */
export function takeReward(input: {
  readonly rewardId: string;
  readonly product: ProductDto;
  readonly restaurantId: string;
  readonly cart: CartState;
  readonly dispatch: (action: CartAction) => void;
  /** Écran où aller une fois le cadeau ajouté (ex. le panier) ; rien pour rester sur place. */
  readonly then?: '/cart' | null;
}): void {
  const { rewardId, product, restaurantId, cart, dispatch, then = null } = input;
  if (needsChoice(product)) {
    router.navigate({
      pathname: '/r/[restaurantId]/p/[productId]',
      params: { restaurantId, productId: product.id, reward: rewardId },
    });
    return;
  }
  if (!cart.lines.some((l) => l.productId === product.id) || cart.restaurantId !== restaurantId) {
    dispatch({
      type: 'add',
      restaurantId,
      productId: product.id,
      quantity: 1,
      optionIds: [],
      note: null,
    });
  }
  dispatch({ type: 'setReward', reward: { rewardId, productId: product.id } });
  if (then) router.navigate(then);
}
