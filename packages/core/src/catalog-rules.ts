import type { OrderMode, Totals } from './fees';
import { MIN_CHARGE_CENTS } from './loyalty';
import { addCents, cents, type Cents } from './money';
import type { PricedLine } from './pricing';

/**
 * Promotions de catalogue de la caisse Splash360 (`reglescatalogue`), appliquées en ligne comme
 * en caisse (réponse du directeur technique de Splash360 du 26/11, relevée dans le code de la
 * caisse, lot 24, ADR 0030). `packages/api-menu` traduit la carte vers ce type.
 */
export type CatalogRuleMode = 'surplace' | 'emporter' | 'livraison' | 'all';

/** Valeur d'une règle : pourcentage en centièmes de point (10 000 = 100 %) ou montant fixe. */
export type CatalogRuleValue =
  | { readonly kind: 'percent'; readonly hundredths: number }
  | { readonly kind: 'fixed'; readonly cents: Cents };

export interface CatalogRule {
  /** `reglecatalogue_id` (une copie par mode : `modifier4_emporter`…). */
  readonly id: string;
  /** Nom exact de la règle : renvoyé tel quel à la caisse, qui remplace au lieu d'ajouter. */
  readonly name: string;
  readonly mode: CatalogRuleMode;
  /** Début et fin en millisecondes ; `endsAt` null : sans fin (`end` = 0). */
  readonly startsAt: number;
  readonly endsAt: number | null;
  /** Articles comptés par lots de `max` ; dans chaque lot, les rangs `min` à `max` sont remisés. */
  readonly min: number;
  readonly max: number;
  /** Nombre maximal d'articles remisés par commande ; 0 = sans limite. */
  readonly quantity: number;
  /** Produits concernés ; vide = règle sur toute la commande. */
  readonly productIds: readonly string[];
  /** `one` : chaque produit compté séparément ; `all` : tous les produits de la liste ensemble. */
  readonly selection: 'one' | 'all';
  readonly value: CatalogRuleValue;
  /** Valeur telle que reçue (« 100% », « 3.9€ »). */
  readonly valueLabel: string;
  /** -1 : remise ; +1 : frais ajoutés (seulement pour une règle sans produits). */
  readonly operation: -1 | 1;
  /** `taux` reçu (TVA des frais ?), null si absent. */
  readonly vatRate: number | null;
}

/** Remise d'une règle sur une ligne : `units` articles remisés de `unitDiscountCents` chacun. */
export interface LineDiscount {
  readonly ruleId: string;
  readonly name: string;
  readonly units: number;
  readonly unitDiscountCents: Cents;
  /**
   * Remise d'un article en pourcentage de son prix unitaire, au format de la caisse (« 100% »,
   * « 39.04% ») : la caisse lit mal un montant en euros sur un article (réponse du 26/11).
   */
  readonly percentLabel: string;
}

export interface CatalogItemDiscount extends LineDiscount {
  /** Index de la ligne du panier. */
  readonly line: number;
}

/** Remise ou frais d'une règle sans produits, sur toute la commande. */
export interface CatalogOrderAdjustment {
  readonly ruleId: string;
  readonly name: string;
  readonly kind: 'discount' | 'fee';
  readonly cents: Cents;
  readonly valueLabel: string;
  readonly vatRate: number | null;
}

export interface CatalogResult {
  readonly items: readonly CatalogItemDiscount[];
  readonly itemDiscountCents: Cents;
  /** Une seule remise sur la commande : la première règle de la liste. */
  readonly orderDiscount: CatalogOrderAdjustment | null;
  readonly fees: readonly CatalogOrderAdjustment[];
  /** Remises articles + remise commande. */
  readonly discountCents: Cents;
  readonly feeCents: Cents;
}

export const EMPTY_CATALOG_RESULT: CatalogResult = {
  items: [],
  itemDiscountCents: cents(0),
  orderDiscount: null,
  fees: [],
  discountCents: cents(0),
  feeCents: cents(0),
};

/** Mode de la caisse correspondant au mode de commande : à emporter → `emporter`, livraison → `livraison`. */
export const CATALOG_MODE: Readonly<Record<OrderMode, CatalogRuleMode>> = {
  pickup: 'emporter',
  delivery: 'livraison',
};

/** Règle exploitable : `min` > 0 avec `max` = 0 est ignorée (caisse). */
function usable(rule: CatalogRule): boolean {
  if (rule.min > 0 && rule.max === 0) return false;
  if (rule.operation === 1 && rule.productIds.length > 0) return false;
  return true;
}

/**
 * Règles en vigueur pour une commande : copie du mode de la commande ou `all`, `start` ≤ maintenant
 * ≤ `end` (`end` absent : sans fin), règle exploitable. L'ordre de la liste est gardé (priorité).
 */
export function activeCatalogRules(
  rules: readonly CatalogRule[] | undefined,
  mode: OrderMode,
  now: Date,
): CatalogRule[] {
  const t = now.getTime();
  return (rules ?? []).filter(
    (r) =>
      (r.mode === 'all' || r.mode === CATALOG_MODE[mode]) &&
      r.startsAt <= t &&
      (r.endsAt === null || t <= r.endsAt) &&
      usable(r),
  );
}

/**
 * Nombre d'articles remisés parmi `n` : comptés par lots de `max`, rangs `min` à `max` remisés
 * dans chaque lot (rang dans le lot), lot incomplet compris pour les rangs atteints. 4/4 : le 4e
 * (8 → 2, 7 → 1) ; 2/3 : 2e et 3e ; 0/0 : tous.
 */
export function discountedCount(n: number, min: number, max: number): number {
  if (n <= 0) return 0;
  if (max === 0) return min === 0 ? n : 0;
  const lo = Math.max(1, min);
  if (lo > max) return 0;
  const perPack = max - lo + 1;
  const rest = n % max;
  return Math.floor(n / max) * perPack + Math.max(0, rest - lo + 1);
}

function percentOf(amount: number, hundredths: number): number {
  return Math.round((amount * Math.min(10_000, Math.max(0, hundredths))) / 10_000);
}

/** 10 000 → « 100% », 3 904 → « 39.04% », 1 050 → « 10.5% ». */
export function formatPercentLabel(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}

function unitDiscount(rule: CatalogRule, unitPrice: number): number {
  return rule.value.kind === 'percent'
    ? percentOf(unitPrice, rule.value.hundredths)
    : Math.min(rule.value.cents, unitPrice);
}

/**
 * Pourcentage envoyé à la caisse pour un article : celui de la règle, ou, pour une remise en euros,
 * la part du prix unitaire qu'elle représente, arrondie au centième de point (nos totaux gardent
 * les centimes exacts).
 */
function percentLabelFor(rule: CatalogRule, unitPrice: number, discount: number): string {
  if (rule.value.kind === 'percent')
    return formatPercentLabel(Math.min(10_000, rule.value.hundredths));
  return itemPercentLabel(discount, unitPrice);
}

/** Remise d'un article exprimée en pourcentage de son prix (arrondi au centième de point). */
export function itemPercentLabel(discountCents: number, unitPriceCents: number): string {
  if (unitPriceCents <= 0) return '0%';
  return formatPercentLabel(
    Math.min(10_000, Math.round((discountCents * 10_000) / unitPriceCents)),
  );
}

/** Article encore remisable d'une ligne. */
interface Unit {
  readonly line: number;
  readonly productId: string;
  readonly price: number;
}

/**
 * Applique les promotions de catalogue au panier, comme la caisse (fonction pure) :
 * - règle avec produits (`operation` -1) : articles comptés par lots (`discountedCount`) ; en
 *   `all`, tous les produits de la liste ensemble et remise sur les articles les moins chers ;
 *   en `one`, produit par produit ; `quantity` plafonne le nombre d'articles remisés ;
 * - un article ne reçoit qu'une remise : la première règle de la liste ; un article déjà remisé
 *   (`reservedUnits` : cadeau fidélité) n'est ni compté ni remisé ;
 * - règle sans produits : remise (une seule, la première ; aucune si `orderDiscountTaken`, code
 *   promo du client) ou frais, sur le total déjà remisé (articles et `alreadyDiscountedCents`) ;
 * - prix d'un article = prix unitaire de la ligne, options comprises.
 */
export function applyCatalogRules(input: {
  readonly lines: readonly PricedLine[];
  readonly rules: readonly CatalogRule[] | undefined;
  readonly mode: OrderMode;
  readonly now: Date;
  /** Articles déjà remisés (cadeau fidélité), par ligne. */
  readonly reservedUnits?: readonly { readonly line: number; readonly units: number }[];
  /** Remises déjà déduites hors règles (cadeau fidélité), pour la base des remises commande. */
  readonly alreadyDiscountedCents?: number;
  /** Une remise sur la commande existe déjà (code promo) : aucune remise commande de règle. */
  readonly orderDiscountTaken?: boolean;
}): CatalogResult {
  const rules = activeCatalogRules(input.rules, input.mode, input.now);
  if (rules.length === 0) return EMPTY_CATALOG_RESULT;

  // Articles encore libres, ligne par ligne (une unité par article).
  const free = input.lines.map((l, i) => {
    const reserved = (input.reservedUnits ?? [])
      .filter((r) => r.line === i)
      .reduce((s, r) => s + Math.max(0, r.units), 0);
    return Math.max(0, l.quantity - reserved);
  });

  const items: CatalogItemDiscount[] = [];
  for (const rule of rules) {
    if (rule.productIds.length === 0 || rule.operation !== -1) continue;
    const concerned = new Set(rule.productIds);
    const units: Unit[] = input.lines.flatMap((l, line) =>
      concerned.has(l.productId)
        ? Array.from({ length: free[line] ?? 0 }, () => ({
            line,
            productId: l.productId,
            price: l.unitPriceCents,
          }))
        : [],
    );
    // `one` : un groupe par produit, dans l'ordre du panier ; `all` : un seul groupe.
    const groups: Unit[][] =
      rule.selection === 'one'
        ? [...new Set(units.map((u) => u.productId))].map((p) =>
            units.filter((u) => u.productId === p),
          )
        : [units];
    let cap = rule.quantity > 0 ? rule.quantity : Number.POSITIVE_INFINITY;
    const picked = new Map<number, number>();
    for (const group of groups) {
      const n = Math.min(cap, discountedCount(group.length, rule.min, rule.max));
      if (n <= 0) continue;
      cap -= n;
      // Les moins chers d'abord (à prix égal, la dernière ligne du panier).
      const cheapest = [...group].sort((a, b) => a.price - b.price || b.line - a.line).slice(0, n);
      for (const u of cheapest) picked.set(u.line, (picked.get(u.line) ?? 0) + 1);
    }
    for (const [line, count] of [...picked.entries()].sort((a, b) => a[0] - b[0])) {
      const price = input.lines[line]?.unitPriceCents ?? 0;
      const discount = unitDiscount(rule, price);
      free[line] = (free[line] ?? 0) - count;
      if (discount <= 0) continue;
      items.push({
        line,
        ruleId: rule.id,
        name: rule.name,
        units: count,
        unitDiscountCents: cents(discount),
        percentLabel: percentLabelFor(rule, price, discount),
      });
    }
  }

  const itemDiscountCents = addCents(
    cents(0),
    ...items.map((d) => cents(d.unitDiscountCents * d.units)),
  );
  const subtotal = input.lines.reduce((s, l) => s + l.totalCents, 0);
  const base = Math.max(0, subtotal - (input.alreadyDiscountedCents ?? 0) - itemDiscountCents);

  let orderDiscount: CatalogOrderAdjustment | null = null;
  const fees: CatalogOrderAdjustment[] = [];
  for (const rule of rules) {
    if (rule.productIds.length > 0) continue;
    const amount =
      rule.value.kind === 'percent'
        ? percentOf(base, rule.value.hundredths)
        : Math.min(rule.value.cents, rule.operation === -1 ? base : rule.value.cents);
    const adjustment = (kind: 'discount' | 'fee'): CatalogOrderAdjustment => ({
      ruleId: rule.id,
      name: rule.name,
      kind,
      cents: cents(amount),
      valueLabel: rule.valueLabel,
      vatRate: rule.vatRate,
    });
    if (rule.operation === 1) {
      if (amount > 0) fees.push(adjustment('fee'));
    } else if (!orderDiscount && !input.orderDiscountTaken && amount > 0) {
      orderDiscount = adjustment('discount');
    }
  }

  const feeCents = addCents(cents(0), ...fees.map((f) => f.cents));
  return {
    items,
    itemDiscountCents,
    orderDiscount,
    fees,
    discountCents: addCents(itemDiscountCents, orderDiscount?.cents ?? cents(0)),
    feeCents,
  };
}

/** Produits concernés par une règle de remise en vigueur (badge « Promo » de l'application). */
export function promotedProducts(
  rules: readonly CatalogRule[] | undefined,
  mode: OrderMode,
  now: Date,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of activeCatalogRules(rules, mode, now)) {
    if (r.operation !== -1) continue;
    for (const id of r.productIds) if (!out.has(id)) out.set(id, r.name);
  }
  return out;
}

/**
 * Totaux complétés des promotions de catalogue (après le cadeau fidélité, avant le code promo).
 * Il doit rester au moins `MIN_CHARGE_CENTS` à payer : une commande n'est jamais gratuite.
 */
export function applyCatalogToTotals(
  totals: Totals,
  result: CatalogResult,
):
  | { readonly ok: true; readonly totals: Totals }
  | { readonly ok: false; readonly error: 'catalog_needs_paid_amount' } {
  if (result.discountCents === 0 && result.feeCents === 0) return { ok: true, totals };
  const total = totals.totalCents - result.discountCents + result.feeCents;
  if (total < MIN_CHARGE_CENTS) return { ok: false, error: 'catalog_needs_paid_amount' };
  return {
    ok: true,
    totals: {
      ...totals,
      catalogDiscountCents: result.discountCents,
      catalogFeeCents: result.feeCents,
      totalCents: cents(total),
    },
  };
}
