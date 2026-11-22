import type { Cents } from './money';

/**
 * Types internes de la carte. Ils ne reproduisent pas le format de l'API menu Splash360 :
 * `packages/api-menu` traduit sa réponse vers ces types (règle non négociable n° 5).
 */
export interface MenuOption {
  readonly id: string;
  readonly name: string;
  /** Supplément en centimes (0 si gratuit). */
  readonly priceCents: Cents;
  readonly available: boolean;
}

export interface OptionGroup {
  readonly id: string;
  readonly name: string;
  /** Nombre minimal de choix ; > 0 signifie « obligatoire ». */
  readonly min: number;
  /** Nombre maximal de choix. */
  readonly max: number;
  readonly options: readonly MenuOption[];
}

export interface MenuProduct {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: Cents;
  readonly imageUrl: string | null;
  readonly available: boolean;
  readonly allergens: readonly string[];
  readonly optionGroups: readonly OptionGroup[];
}

export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

export interface Menu {
  readonly restaurantId: string;
  readonly categories: readonly MenuCategory[];
  readonly products: readonly MenuProduct[];
}

export function isRequired(group: OptionGroup): boolean {
  return group.min > 0;
}
