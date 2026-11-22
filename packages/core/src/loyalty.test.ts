import { describe, expect, it } from 'vitest';
import { computeTotals } from './fees';
import { applyReward, pointsForAmount, type LoyaltyReward } from './loyalty';
import { cents } from './money';
import type { PricedLine } from './pricing';

const rules = { pointsPerEuro: 10 };
const fries: LoyaltyReward = {
  id: 'rw-frites',
  name: 'Frites',
  costPoints: 400,
  productId: 'frites',
};

function line(productId: string, base: number, options: number[] = [], quantity = 1): PricedLine {
  const unit = base + options.reduce((a, b) => a + b, 0);
  return {
    productId,
    name: productId,
    quantity,
    basePriceCents: cents(base),
    options: options.map((p, i) => ({
      optionId: `o${i}`,
      groupId: 'g',
      name: `o${i}`,
      priceCents: cents(p),
    })),
    unitPriceCents: cents(unit),
    totalCents: cents(unit * quantity),
    note: null,
  };
}

function totalsFor(lines: PricedLine[], mode: 'pickup' | 'delivery' = 'pickup') {
  const result = computeTotals({
    mode,
    subtotalCents: cents(lines.reduce((s, l) => s + l.totalCents, 0)),
    settings: {
      deliveryMinimumCents: cents(1500),
      freeDeliveryThresholdCents: null,
      serviceFeeCents: cents(0),
    },
    zoneFeeCents: cents(299),
  });
  if (!result.ok) throw new Error('totaux');
  return result.totals;
}

describe('points de fidélité', () => {
  it('10 points par euro, arrondi à l’inférieur', () => {
    expect(pointsForAmount(cents(1810), rules)).toBe(181);
    expect(pointsForAmount(cents(1899), rules)).toBe(189);
    expect(pointsForAmount(cents(9), rules)).toBe(0);
    expect(pointsForAmount(cents(0), rules)).toBe(0);
  });

  it('refuse une règle invalide', () => {
    expect(() => pointsForAmount(cents(100), { pointsPerEuro: -1 })).toThrow();
    expect(() => pointsForAmount(cents(100), { pointsPerEuro: 1.5 })).toThrow();
  });
});

describe('récompense « produit offert »', () => {
  it('déduit le prix de base du produit, pas ses options', () => {
    const lines = [line('burger', 1490), line('frites', 350, [100], 2)];
    const totals = totalsFor(lines);
    const r = applyReward({ totals, lines, reward: fries, balance: 640 });
    expect(r).toMatchObject({ ok: true, discountCents: 350 });
    if (r.ok) {
      expect(r.totals.totalCents).toBe(totals.totalCents - 350);
      expect(r.totals.subtotalCents).toBe(totals.subtotalCents);
    }
  });

  it('exige le produit dans le panier et assez de points', () => {
    const lines = [line('burger', 1490)];
    expect(applyReward({ totals: totalsFor(lines), lines, reward: fries, balance: 640 })).toEqual({
      ok: false,
      error: 'reward_product_missing',
    });
    const withFries = [line('frites', 350)];
    expect(
      applyReward({ totals: totalsFor(withFries), lines: withFries, reward: fries, balance: 399 }),
    ).toEqual({ ok: false, error: 'insufficient_points' });
  });

  it('garde les frais de livraison et exige un reste à payer encaissable', () => {
    const lines = [line('frites', 2000)];
    const r = applyReward({
      totals: totalsFor(lines, 'delivery'),
      lines,
      reward: fries,
      balance: 1000,
    });
    expect(r.ok && r.totals.totalCents).toBe(299);
    // Seulement le produit offert, à emporter : rien à payer, donc refusé.
    const alone = [line('frites', 350)];
    expect(
      applyReward({ totals: totalsFor(alone), lines: alone, reward: fries, balance: 1000 }),
    ).toEqual({
      ok: false,
      error: 'reward_needs_paid_items',
    });
    // 0,50 € restant : accepté.
    const withExtra = [line('frites', 350), line('sauce', 50)];
    expect(
      applyReward({ totals: totalsFor(withExtra), lines: withExtra, reward: fries, balance: 1000 })
        .ok,
    ).toBe(true);
  });
});
