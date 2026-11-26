import { describe, expect, it } from 'vitest';
import {
  activeCatalogRules,
  applyCatalogRules,
  applyCatalogToTotals,
  discountedCount,
  formatPercentLabel,
  itemPercentLabel,
  promotedProducts,
  type CatalogRule,
} from './catalog-rules';
import { computeTotals } from './fees';
import { cents } from './money';
import type { PricedLine } from './pricing';
import { applyPromo } from './promo';

const NOW = new Date('2026-11-26T12:00:00+01:00');

function line(productId: string, unitPrice: number, quantity = 1): PricedLine {
  return {
    productId,
    name: productId,
    quantity,
    basePriceCents: cents(unitPrice),
    options: [],
    unitPriceCents: cents(unitPrice),
    totalCents: cents(unitPrice * quantity),
    note: null,
  };
}

function rule(overrides: Partial<CatalogRule> = {}): CatalogRule {
  return {
    id: 'modifier4_emporter',
    name: '3 acheter = 1',
    mode: 'emporter',
    startsAt: NOW.getTime() - 86_400_000,
    endsAt: null,
    min: 4,
    max: 4,
    quantity: 0,
    productIds: ['coca', 'fanta', 'burger', 'frites'],
    selection: 'all',
    value: { kind: 'percent', hundredths: 10_000 },
    valueLabel: '100%',
    operation: -1,
    vatRate: 0,
    ...overrides,
  };
}

const run = (
  lines: PricedLine[],
  rules: CatalogRule[],
  extra: Partial<Parameters<typeof applyCatalogRules>[0]> = {},
) => applyCatalogRules({ lines, rules, mode: 'pickup', now: NOW, ...extra });

describe('discountedCount (lots de max, rangs min à max)', () => {
  it('4/4 : le 4e offert, à chaque lot complet (8 → 2, 7 → 1)', () => {
    expect([3, 4, 7, 8, 12].map((n) => discountedCount(n, 4, 4))).toEqual([0, 1, 1, 2, 3]);
  });
  it('3/3 : le 3e', () => {
    expect([2, 3, 5, 6].map((n) => discountedCount(n, 3, 3))).toEqual([0, 1, 1, 2]);
  });
  it('2/3 : le 2e et le 3e de chaque lot de 3', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => discountedCount(n, 2, 3))).toEqual([0, 1, 2, 2, 3, 4]);
  });
  it('0/0 : tous les articles', () => {
    expect(discountedCount(5, 0, 0)).toBe(5);
  });
  it('min > 0 et max = 0 : aucun', () => {
    expect(discountedCount(5, 2, 0)).toBe(0);
  });
});

describe('activeCatalogRules', () => {
  const copies = [
    rule({ id: 'r_surplace', mode: 'surplace' }),
    rule({ id: 'r_emporter', mode: 'emporter' }),
    rule({ id: 'r_livraison', mode: 'livraison' }),
    rule({ id: 'r_all', mode: 'all' }),
  ];

  it('garde la copie du mode de la commande et « all »', () => {
    expect(activeCatalogRules(copies, 'pickup', NOW).map((r) => r.id)).toEqual([
      'r_emporter',
      'r_all',
    ]);
    expect(activeCatalogRules(copies, 'delivery', NOW).map((r) => r.id)).toEqual([
      'r_livraison',
      'r_all',
    ]);
  });

  it('dates : avant le début, après la fin, sans fin (end = 0)', () => {
    const t = NOW.getTime();
    expect(activeCatalogRules([rule({ startsAt: t + 1 })], 'pickup', NOW)).toEqual([]);
    expect(activeCatalogRules([rule({ startsAt: t - 10, endsAt: t - 1 })], 'pickup', NOW)).toEqual(
      [],
    );
    expect(activeCatalogRules([rule({ startsAt: t, endsAt: t })], 'pickup', NOW)).toHaveLength(1);
    expect(activeCatalogRules([rule({ endsAt: null })], 'pickup', NOW)).toHaveLength(1);
  });

  it('ignore min > 0 avec max = 0, et des frais sur des produits', () => {
    expect(activeCatalogRules([rule({ min: 3, max: 0 })], 'pickup', NOW)).toEqual([]);
    expect(activeCatalogRules([rule({ operation: 1 })], 'pickup', NOW)).toEqual([]);
  });
});

describe('applyCatalogRules', () => {
  it('« all » : panier 10, 10, 6, 4 € avec le 4e offert → l’article à 4 € offert', () => {
    const r = run(
      [line('burger', 1000), line('burger', 1000), line('frites', 600), line('coca', 400)],
      [rule()],
    );
    expect(r.items).toEqual([
      {
        line: 3,
        ruleId: 'modifier4_emporter',
        name: '3 acheter = 1',
        units: 1,
        unitDiscountCents: 400,
        percentLabel: '100%',
      },
    ]);
    expect(r.discountCents).toBe(400);
  });

  it('« all » : les moins chers parmi tous les articles concernés, à chaque lot (8 → 2)', () => {
    const r = run(
      [line('burger', 1000, 6), line('coca', 300, 1), line('frites', 500, 1)],
      [rule()],
    );
    expect(r.items.map((d) => [d.line, d.units])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(r.itemDiscountCents).toBe(800);
    // 7 articles : un seul offert.
    expect(run([line('burger', 1000, 7)], [rule()]).itemDiscountCents).toBe(1000);
  });

  it('3/3 : le 3e offert ; 2/3 à 50 % : le 2e et le 3e remisés', () => {
    expect(run([line('coca', 300, 3)], [rule({ min: 3, max: 3 })]).itemDiscountCents).toBe(300);
    const half = run(
      [line('burger', 1000), line('frites', 600), line('coca', 400)],
      [rule({ min: 2, max: 3, value: { kind: 'percent', hundredths: 5000 }, valueLabel: '50%' })],
    );
    expect(half.items.map((d) => [d.line, d.unitDiscountCents, d.percentLabel])).toEqual([
      [1, 300, '50%'],
      [2, 200, '50%'],
    ]);
  });

  it('0/0 : chaque article remisé', () => {
    const r = run(
      [line('burger', 1000, 2), line('salade', 800)],
      [rule({ min: 0, max: 0, value: { kind: 'percent', hundredths: 1000 }, valueLabel: '10%' })],
    );
    expect(r.items).toMatchObject([{ line: 0, units: 2, unitDiscountCents: 100 }]);
    expect(r.discountCents).toBe(200);
  });

  it('min > 0 et max = 0 : règle ignorée', () => {
    expect(run([line('coca', 300, 8)], [rule({ min: 4, max: 0 })])).toMatchObject({
      items: [],
      discountCents: 0,
    });
  });

  it('quantite : plafond d’articles remisés par commande', () => {
    const r = run([line('coca', 300, 12)], [rule({ quantity: 2 })]);
    expect(r.items).toMatchObject([{ units: 2 }]);
    expect(r.itemDiscountCents).toBe(600);
  });

  it('« one » : chaque produit compté à part (4 Coca oui, 2 Coca + 2 Fanta non)', () => {
    const one = rule({ selection: 'one' });
    expect(run([line('coca', 300, 4)], [one]).items).toMatchObject([{ line: 0, units: 1 }]);
    expect(run([line('coca', 300, 2), line('fanta', 300, 2)], [one]).items).toEqual([]);
    // En « all », les quatre comptent ensemble.
    expect(run([line('coca', 300, 2), line('fanta', 300, 2)], [rule()]).items).toHaveLength(1);
    // Produit par produit, remise sur la ligne de ce produit ; plafond commun à la commande.
    const both = run([line('coca', 300, 4), line('fanta', 250, 4)], [one]);
    expect(both.items.map((d) => [d.line, d.units])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(
      run([line('coca', 300, 4), line('fanta', 250, 4)], [rule({ selection: 'one', quantity: 1 })])
        .items,
    ).toMatchObject([{ line: 0, units: 1 }]);
  });

  it('« one » : un même produit sur deux lignes (options différentes), le moins cher remisé', () => {
    const r = run([line('burger', 1200), line('burger', 1000, 3)], [rule({ selection: 'one' })]);
    expect(r.items).toMatchObject([{ line: 1, units: 1, unitDiscountCents: 1000 }]);
  });

  it('remise en euros sur un article : convertie en pourcentage du prix unitaire', () => {
    const r = run(
      [line('burger', 999, 2)],
      [rule({ min: 2, max: 2, value: { kind: 'fixed', cents: cents(390) }, valueLabel: '3.9€' })],
    );
    expect(r.items).toMatchObject([{ units: 1, unitDiscountCents: 390, percentLabel: '39.04%' }]);
    // Remise plus grande que le prix : article offert.
    const big = run(
      [line('coca', 300, 2)],
      [rule({ min: 2, max: 2, value: { kind: 'fixed', cents: cents(500) }, valueLabel: '5€' })],
    );
    expect(big.items).toMatchObject([{ unitDiscountCents: 300, percentLabel: '100%' }]);
  });

  it('un article ne reçoit qu’une remise : la première règle de la liste', () => {
    const first = rule({ id: 'a', name: 'A', min: 0, max: 0, valueLabel: '100%' });
    const second = rule({
      id: 'b',
      name: 'B',
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 5000 },
      valueLabel: '50%',
      productIds: ['coca', 'burger'],
    });
    const r = run([line('coca', 300, 2), line('burger', 1000)], [first, second]);
    expect(r.items.map((d) => [d.ruleId, d.line, d.units])).toEqual([
      ['a', 0, 2],
      ['a', 1, 1],
    ]);
  });

  it('cadeau fidélité (remise existante) prioritaire : l’article offert n’est ni compté ni remisé', () => {
    const lines = [line('coca', 300, 4)];
    expect(run(lines, [rule()]).items).toMatchObject([{ units: 1 }]);
    expect(run(lines, [rule()], { reservedUnits: [{ line: 0, units: 1 }] }).items).toEqual([]);
  });

  it('remise article puis remise commande sur le total déjà remisé : 40 − 10 − 3 = 27 €', () => {
    const order = rule({
      id: 'dix',
      name: '10 % sur la commande',
      productIds: [],
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 1000 },
      valueLabel: '10%',
    });
    const lines = [line('burger', 1000, 4)];
    const r = run(lines, [order, rule()]);
    expect(r.itemDiscountCents).toBe(1000);
    expect(r.orderDiscount).toMatchObject({ ruleId: 'dix', kind: 'discount', cents: 300 });
    expect(r.discountCents).toBe(1300);
    const totals = computeTotals({
      mode: 'pickup',
      subtotalCents: cents(4000),
      settings: {
        deliveryMinimumCents: cents(0),
        freeDeliveryThresholdCents: null,
        serviceFeeCents: cents(0),
      },
    });
    if (!totals.ok) throw new Error('totaux');
    const applied = applyCatalogToTotals(totals.totals, r);
    expect(applied).toMatchObject({
      ok: true,
      totals: { catalogDiscountCents: 1300, totalCents: 2700 },
    });
  });

  it('deux remises commande (deux règles) : seule la première compte', () => {
    const a = rule({
      id: 'a',
      productIds: [],
      min: 0,
      max: 0,
      value: { kind: 'fixed', cents: cents(500) },
      valueLabel: '5€',
    });
    const b = rule({
      id: 'b',
      productIds: [],
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 2000 },
      valueLabel: '20%',
    });
    const r = run([line('burger', 1000, 3)], [a, b]);
    expect(r.orderDiscount).toMatchObject({ ruleId: 'a', cents: 500 });
    expect(r.discountCents).toBe(500);
  });

  it('code promo du client déjà présent : aucune remise commande de règle (le code gagne)', () => {
    const a = rule({
      productIds: [],
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 1000 },
      valueLabel: '10%',
    });
    const r = run([line('burger', 1000, 4)], [a, rule()], { orderDiscountTaken: true });
    expect(r.orderDiscount).toBeNull();
    // Les remises articles restent.
    expect(r.discountCents).toBe(1000);
  });

  it('remise commande calculée après le cadeau fidélité (remise existante)', () => {
    const a = rule({
      productIds: [],
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 1000 },
      valueLabel: '10%',
    });
    const r = run([line('burger', 1000, 2)], [a], { alreadyDiscountedCents: 1000 });
    expect(r.orderDiscount?.cents).toBe(100);
  });

  it('frais (operation +1, sans produits) : ajoutés, en euros ou en pourcentage', () => {
    const fixed = rule({
      id: 'emballage',
      name: 'Emballage',
      productIds: [],
      operation: 1,
      min: 0,
      max: 0,
      value: { kind: 'fixed', cents: cents(50) },
      valueLabel: '0.5€',
      vatRate: 0.1,
    });
    const pct = rule({
      id: 'service',
      name: 'Service',
      productIds: [],
      operation: 1,
      min: 0,
      max: 0,
      value: { kind: 'percent', hundredths: 500 },
      valueLabel: '5%',
    });
    const r = run([line('burger', 1000, 2)], [fixed, pct]);
    expect(r.fees).toEqual([
      {
        ruleId: 'emballage',
        name: 'Emballage',
        kind: 'fee',
        cents: 50,
        valueLabel: '0.5€',
        vatRate: 0.1,
      },
      { ruleId: 'service', name: 'Service', kind: 'fee', cents: 100, valueLabel: '5%', vatRate: 0 },
    ]);
    expect(r.feeCents).toBe(150);
  });

  it('mode et dates : règle d’une autre copie ou périmée sans effet', () => {
    const lines = [line('coca', 300, 4)];
    expect(run(lines, [rule({ mode: 'surplace' })]).items).toEqual([]);
    expect(run(lines, [rule({ mode: 'livraison' })]).items).toEqual([]);
    expect(run(lines, [rule({ mode: 'livraison' })], { mode: 'delivery' }).items).toHaveLength(1);
    expect(run(lines, [rule({ endsAt: NOW.getTime() - 1 })]).items).toEqual([]);
  });

  it('produit hors liste : jamais compté', () => {
    expect(run([line('coca', 300, 3), line('eau', 200)], [rule()]).items).toEqual([]);
  });
});

describe('applyCatalogToTotals et code promo', () => {
  const settings = {
    deliveryMinimumCents: cents(0),
    freeDeliveryThresholdCents: null,
    serviceFeeCents: cents(0),
  };

  it('le code promo se calcule après les remises articles', () => {
    const base = computeTotals({ mode: 'pickup', subtotalCents: cents(4000), settings });
    if (!base.ok) throw new Error('totaux');
    const catalog = run([line('burger', 1000, 4)], [rule()]);
    const withCatalog = applyCatalogToTotals(base.totals, catalog);
    if (!withCatalog.ok) throw new Error('catalogue');
    const promo = applyPromo({
      totals: withCatalog.totals,
      promo: {
        code: 'DIX',
        kind: 'percent',
        value: 10,
        minSubtotalCents: 0,
        startsAt: null,
        endsAt: null,
        maxUses: null,
        active: true,
      },
      now: NOW,
      uses: 0,
      alreadyUsed: false,
    });
    expect(promo).toMatchObject({
      ok: true,
      promoDiscountCents: 300,
      totals: { totalCents: 2700 },
    });
  });

  it('commande jamais gratuite', () => {
    const base = computeTotals({ mode: 'pickup', subtotalCents: cents(300), settings });
    if (!base.ok) throw new Error('totaux');
    const all = run([line('coca', 300)], [rule({ min: 0, max: 0 })]);
    expect(applyCatalogToTotals(base.totals, all)).toEqual({
      ok: false,
      error: 'catalog_needs_paid_amount',
    });
  });

  it('sans promotion : totaux inchangés', () => {
    const base = computeTotals({ mode: 'pickup', subtotalCents: cents(300), settings });
    if (!base.ok) throw new Error('totaux');
    expect(applyCatalogToTotals(base.totals, run([line('coca', 300)], []))).toEqual({
      ok: true,
      totals: base.totals,
    });
  });
});

describe('libellés et badges', () => {
  it('pourcentage au format de la caisse', () => {
    expect(formatPercentLabel(10_000)).toBe('100%');
    expect(formatPercentLabel(1050)).toBe('10.5%');
    expect(formatPercentLabel(3904)).toBe('39.04%');
    expect(itemPercentLabel(350, 1050)).toBe('33.33%');
    expect(itemPercentLabel(100, 0)).toBe('0%');
  });

  it('produits en promotion pour le mode et l’instant', () => {
    const map = promotedProducts(
      [rule({ productIds: ['coca'] }), rule({ productIds: [], operation: 1 })],
      'pickup',
      NOW,
    );
    expect([...map.entries()]).toEqual([['coca', '3 acheter = 1']]);
    expect(promotedProducts([rule()], 'delivery', NOW).size).toBe(0);
  });
});
