import type { Menu } from '@splash360/core';

/** Identifie un point de vente côté Splash360. */
export interface MenuSource {
  readonly restaurantId: string;
  readonly splash360RestaurantId: string;
  /** Restaurant branché sur la vraie API Splash360 (ADR 0018) ; sinon carte de démonstration. */
  readonly live?: boolean;
}

/**
 * Source de la carte : l'API Splash360 (`createSplash360MenuProvider`) pour les restaurants
 * branchés, une carte de démonstration pour les autres (`createRoutingMenuProvider`).
 */
export interface MenuProvider {
  fetchMenu(source: MenuSource): Promise<Menu>;
}

export class MenuUnavailableError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MenuUnavailableError';
  }
}

/** Choisit la carte réelle pour un restaurant branché (et si les identifiants sont posés), sinon la démo. */
export function createRoutingMenuProvider(input: {
  readonly demo: MenuProvider;
  readonly live: MenuProvider | null;
}): MenuProvider {
  return {
    fetchMenu: (source) =>
      source.live && input.live ? input.live.fetchMenu(source) : input.demo.fetchMenu(source),
  };
}
