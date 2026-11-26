import type { CatalogRule } from './catalog-rules';
import type { OrderMode } from './fees';
import type { Cents } from './money';

/**
 * Prix propres à un mode de commande (Splash360 `prixArray_c` / `supplementArray_c` : à emporter
 * = entrée 1, livraison = entrée 2, réponse du 26/11). Absent : `priceCents` vaut pour tous les modes.
 */
export type ModePrices = Readonly<Record<OrderMode, Cents>>;

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
  /** Supplément par mode ; prioritaire sur `priceCents` une fois le mode connu (`menuForMode`). */
  readonly modePrices?: ModePrices | undefined;
}

export interface OptionGroup {
  readonly id: string;
  readonly name: string;
  /** Nombre minimal de choix ; > 0 signifie « obligatoire ». */
  readonly min: number;
  /** Nombre maximal de choix (quantités comprises). */
  readonly max: number;
  /**
   * Nombre de fois qu'une même option peut être choisie (Splash360 `max_par_produit`, défaut 1).
   * Une option choisie deux fois est répétée dans la liste des choix ; la caisse la reçoit une
   * fois avec `qte: 2` (réponse de Splash360 du 26/11).
   */
  readonly maxPerOption?: number | undefined;
  /**
   * Étape imbriquée (formule Splash360) : ce groupe ne s'applique que si l'option `parentOptionId`
   * d'un autre groupe du produit est choisie ; ses identifiants d'option sont alors de la forme
   * `<parent>>` + identifiant (voir `nestedOptionId`), jusqu'à `MAX_NESTING_DEPTH` niveaux.
   */
  readonly parentOptionId?: string | null | undefined;
  readonly options: readonly MenuOption[];
}

export interface MenuProduct {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceCents: Cents;
  /** Prix par mode ; prioritaire sur `priceCents` une fois le mode connu (`menuForMode`). */
  readonly modePrices?: ModePrices | undefined;
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
  /**
   * Promotions de catalogue de la caisse (`reglescatalogue`, lot 24), toutes copies et dates
   * comprises : `applyCatalogRules` choisit celles du mode et de l'instant de la commande.
   */
  readonly catalogRules?: readonly CatalogRule[] | undefined;
}

export function isRequired(group: OptionGroup): boolean {
  return group.min > 0;
}

/** Séparateur entre l'option parente et l'option d'une étape imbriquée. */
export const NESTED_OPTION_SEPARATOR = '>';

/**
 * Niveaux d'étapes imbriquées gérés, comme la caisse Splash360 (réponse du 26/11, lot 24) :
 * option `a` → étape de `a` (options `a>b`) → étape de `a>b` (`a>b>c`) → étape de `a>b>c`.
 */
export const MAX_NESTING_DEPTH = 3;

/** Profondeur d'un groupe : 0 au premier niveau, 1 pour une étape d'option `a`, 2 pour `a>b`… */
export function nestingDepth(group: Pick<OptionGroup, 'parentOptionId'>): number {
  const parent = group.parentOptionId;
  return parent ? parent.split(NESTED_OPTION_SEPARATOR).length : 0;
}

/** Identifiant d'une option d'étape imbriquée : unique dans le produit, parent retrouvable. */
export function nestedOptionId(parentOptionId: string, optionId: string): string {
  return `${parentOptionId}${NESTED_OPTION_SEPARATOR}${optionId}`;
}

/** `parent>option` → { parent, option } ; option simple → parent null. */
export function splitOptionId(id: string): {
  readonly parentId: string | null;
  readonly optionId: string;
} {
  const i = id.lastIndexOf(NESTED_OPTION_SEPARATOR);
  return i < 0
    ? { parentId: null, optionId: id }
    : { parentId: id.slice(0, i), optionId: id.slice(i + 1) };
}

/** Nombre de fois qu'une option du groupe peut être choisie (au moins 1). */
export function maxPerOption(group: OptionGroup): number {
  const n = group.maxPerOption ?? 1;
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
}

/**
 * Carte au prix du mode choisi : chaque produit et chaque option prend son prix du mode s'il en a
 * un, sinon garde `priceCents`. Utilisée par le calcul serveur et pour la carte envoyée à
 * l'application, qui affiche ainsi le prix du mode choisi.
 */
export function menuForMode(menu: Menu, mode: OrderMode): Menu {
  return {
    ...menu,
    products: menu.products.map((p) => ({
      ...p,
      priceCents: p.modePrices?.[mode] ?? p.priceCents,
      optionGroups: p.optionGroups.map((g) => ({
        ...g,
        options: g.options.map((o) => ({ ...o, priceCents: o.modePrices?.[mode] ?? o.priceCents })),
      })),
    })),
  };
}
