import { maxPerOption, type Menu, type MenuProduct } from './menu';
import { addCents, cents, multiplyCents, type Cents } from './money';

/** Ce que l'application envoie : uniquement des identifiants et des quantités. */
export interface CartLineInput {
  readonly productId: string;
  readonly quantity: number;
  /** Une option choisie deux fois (`maxPerOption` > 1) apparaît deux fois. */
  readonly optionIds: readonly string[];
  readonly note?: string | undefined;
}

/** Une unité d'option : une option choisie deux fois donne deux `PricedOption` identiques. */
export interface PricedOption {
  readonly optionId: string;
  readonly groupId: string;
  readonly name: string;
  readonly priceCents: Cents;
}

/** Ligne au prix calculé côté serveur, avec libellés figés pour la commande. */
export interface PricedLine {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly basePriceCents: Cents;
  readonly options: readonly PricedOption[];
  readonly unitPriceCents: Cents;
  readonly totalCents: Cents;
  readonly note: string | null;
}

export type CartErrorCode =
  | 'empty_cart'
  | 'too_many_lines'
  | 'unknown_product'
  | 'product_unavailable'
  | 'invalid_quantity'
  | 'unknown_option'
  | 'option_unavailable'
  | 'duplicate_option'
  | 'too_few_options'
  | 'too_many_options'
  | 'note_too_long';

export interface CartError {
  readonly code: CartErrorCode;
  /** Index de la ligne concernée (absent pour une erreur de panier). */
  readonly line?: number;
  readonly productId?: string;
  readonly groupId?: string;
  readonly optionId?: string;
}

export const MAX_QUANTITY = 99;
export const MAX_LINES = 50;
export const MAX_NOTE_LENGTH = 200;

export type PriceCartResult =
  | { readonly ok: true; readonly lines: readonly PricedLine[]; readonly subtotalCents: Cents }
  | { readonly ok: false; readonly errors: readonly CartError[] };

function priceLine(
  product: MenuProduct,
  input: CartLineInput,
  line: number,
  errors: CartError[],
): PricedLine | null {
  const before = errors.length;
  const productId = product.id;

  if (!product.available) errors.push({ code: 'product_unavailable', line, productId });
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > MAX_QUANTITY
  ) {
    errors.push({ code: 'invalid_quantity', line, productId });
  }
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note && note.length > MAX_NOTE_LENGTH)
    errors.push({ code: 'note_too_long', line, productId });

  // Une option peut revenir plusieurs fois (même option choisie deux fois, `maxPerOption`) :
  // chaque occurrence est une unité, prix compris.
  const counts = new Map<string, number>();
  const chosen: PricedOption[] = [];
  for (const optionId of input.optionIds) {
    const group = product.optionGroups.find((g) => g.options.some((o) => o.id === optionId));
    const option = group?.options.find((o) => o.id === optionId);
    if (!group || !option) {
      errors.push({ code: 'unknown_option', line, productId, optionId });
      continue;
    }
    if (!option.available) {
      errors.push({ code: 'option_unavailable', line, productId, groupId: group.id, optionId });
      continue;
    }
    const n = (counts.get(optionId) ?? 0) + 1;
    counts.set(optionId, n);
    // Une option qui ouvre une étape imbriquée ne se prend qu'une fois (ses choix s'y rattachent).
    const opensStep = product.optionGroups.some((g) => g.parentOptionId === optionId);
    if (n > (opensStep ? 1 : maxPerOption(group))) {
      errors.push({ code: 'duplicate_option', line, productId, groupId: group.id, optionId });
      continue;
    }
    chosen.push({ optionId, groupId: group.id, name: option.name, priceCents: option.priceCents });
  }

  for (const group of product.optionGroups) {
    const inGroup = chosen.filter((o) => o.groupId === group.id);
    // Étape imbriquée : ne compte que si son option parente est choisie.
    if (group.parentOptionId && !counts.has(group.parentOptionId)) {
      for (const o of inGroup)
        errors.push({ code: 'unknown_option', line, productId, optionId: o.optionId });
      continue;
    }
    if (inGroup.length < group.min)
      errors.push({ code: 'too_few_options', line, productId, groupId: group.id });
    if (inGroup.length > group.max)
      errors.push({ code: 'too_many_options', line, productId, groupId: group.id });
  }

  if (errors.length > before) return null;

  // Options rangées dans l'ordre de la carte, pour un affichage stable.
  const order = product.optionGroups.flatMap((g) => g.options.map((o) => o.id));
  chosen.sort((a, b) => order.indexOf(a.optionId) - order.indexOf(b.optionId));

  const unit = addCents(product.priceCents, ...chosen.map((o) => o.priceCents));
  return {
    productId,
    name: product.name,
    quantity: input.quantity,
    basePriceCents: product.priceCents,
    options: chosen,
    unitPriceCents: unit,
    totalCents: multiplyCents(unit, input.quantity),
    note,
  };
}

/**
 * Calcule le panier à partir de la carte. Seule source des montants :
 * l'application ne transmet jamais de prix (règle non négociable n° 1).
 * Pour des prix par mode, passer `menuForMode(menu, mode)`.
 */
export function priceCart(menu: Menu, inputs: readonly CartLineInput[]): PriceCartResult {
  if (inputs.length === 0) return { ok: false, errors: [{ code: 'empty_cart' }] };
  if (inputs.length > MAX_LINES) return { ok: false, errors: [{ code: 'too_many_lines' }] };

  const errors: CartError[] = [];
  const lines: PricedLine[] = [];
  inputs.forEach((input, line) => {
    const product = menu.products.find((p) => p.id === input.productId);
    if (!product) {
      errors.push({ code: 'unknown_product', line, productId: input.productId });
      return;
    }
    const priced = priceLine(product, input, line, errors);
    if (priced) lines.push(priced);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, lines, subtotalCents: addCents(...lines.map((l) => l.totalCents), cents(0)) };
}
