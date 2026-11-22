/**
 * Panier côté application : uniquement des identifiants, quantités et notes,
 * exactement ce qui sera envoyé au serveur (règle non négociable n° 1).
 */
export interface CartLine {
  /** Clé stable : même produit + mêmes options + même note = même ligne. */
  readonly key: string;
  readonly productId: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly note: string | null;
}

export interface CartState {
  readonly restaurantId: string | null;
  readonly lines: readonly CartLine[];
}

export type CartAction =
  | {
      readonly type: 'add';
      readonly restaurantId: string;
      readonly productId: string;
      readonly quantity: number;
      readonly optionIds: readonly string[];
      readonly note: string | null;
    }
  | { readonly type: 'setQuantity'; readonly key: string; readonly quantity: number }
  | { readonly type: 'remove'; readonly key: string }
  | { readonly type: 'clear' }
  | { readonly type: 'restore'; readonly state: CartState };

export const EMPTY_CART: CartState = { restaurantId: null, lines: [] };
export const MAX_LINE_QUANTITY = 99;

export function lineKey(
  productId: string,
  optionIds: readonly string[],
  note: string | null,
): string {
  return [productId, [...optionIds].sort().join('+'), note ?? ''].join('|');
}

const clamp = (q: number) => Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.floor(q)));

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // Un panier ne concerne qu'un restaurant : changer de restaurant le vide.
      const base =
        state.restaurantId === action.restaurantId
          ? state
          : { ...EMPTY_CART, restaurantId: action.restaurantId };
      const note = action.note?.trim() ? action.note.trim() : null;
      const key = lineKey(action.productId, action.optionIds, note);
      const existing = base.lines.find((l) => l.key === key);
      const quantity = clamp(action.quantity);
      if (quantity === 0) return base;
      const lines = existing
        ? base.lines.map((l) =>
            l.key === key ? { ...l, quantity: clamp(l.quantity + quantity) } : l,
          )
        : [
            ...base.lines,
            { key, productId: action.productId, quantity, optionIds: [...action.optionIds], note },
          ];
      return { restaurantId: action.restaurantId, lines };
    }
    case 'setQuantity': {
      const quantity = clamp(action.quantity);
      const lines =
        quantity === 0
          ? state.lines.filter((l) => l.key !== action.key)
          : state.lines.map((l) => (l.key === action.key ? { ...l, quantity } : l));
      return { ...state, lines };
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case 'clear':
      return EMPTY_CART;
    case 'restore':
      return action.state;
  }
}

export function itemCount(state: CartState): number {
  return state.lines.reduce((n, l) => n + l.quantity, 0);
}

/** Relit un panier sauvegardé ; toute donnée corrompue donne un panier vide. */
export function parseStoredCart(raw: string | null): CartState {
  if (!raw) return EMPTY_CART;
  try {
    const data = JSON.parse(raw) as Partial<CartState>;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.lines)) return EMPTY_CART;
    const lines = data.lines.filter(
      (l): l is CartLine =>
        typeof l?.key === 'string' &&
        typeof l.productId === 'string' &&
        Number.isInteger(l.quantity) &&
        l.quantity > 0 &&
        l.quantity <= MAX_LINE_QUANTITY &&
        Array.isArray(l.optionIds) &&
        (l.optionIds as unknown[]).every((o) => typeof o === 'string') &&
        (l.note === null || typeof l.note === 'string'),
    );
    return {
      restaurantId: typeof data.restaurantId === 'string' ? data.restaurantId : null,
      lines,
    };
  } catch {
    return EMPTY_CART;
  }
}
