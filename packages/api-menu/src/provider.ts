import type { Menu } from '@splash360/core';

/** Identifie un point de vente côté Splash360. */
export interface MenuSource {
  readonly restaurantId: string;
  readonly splash360RestaurantId: string;
}

/**
 * Source de la carte. L'implémentation réelle appellera l'API menu Splash360
 * (en attente de sa documentation) ; une carte de démonstration sert en attendant.
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
