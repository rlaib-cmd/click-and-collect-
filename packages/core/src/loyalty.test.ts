import { describe, expect, it } from 'vitest';
import { computeTotals } from './fees';
import {
  applyReward,
  nextReward,
  availablePoints,
  PENDING_PAYMENT_HOLD_MS,
  pointsForAmount,
  reservedRewardPoints,
  type LoyaltyReward,
} from './loyalty';
import { cents } from './money';
import type { PricedLine } from './pricing';

const rules = { pointsPerEuro: 10 };
const fries: LoyaltyReward = {
  id: 'rw-sides',
  name: 'Un side offert',
  costPoints: 400,
  productIds: ['frites', 'onion-rings'],
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
    const r = applyReward({ totals, lines, reward: fries, productId: 'frites', balance: 640 });
    expect(r).toMatchObject({ ok: true, discountCents: 350 });
    if (r.ok) {
      expect(r.totals.totalCents).toBe(totals.totalCents - 350);
      expect(r.totals.subtotalCents).toBe(totals.subtotalCents);
    }
  });

  it('exige le produit dans le panier et assez de points', () => {
    const lines = [line('burger', 1490)];
    expect(
      applyReward({
        totals: totalsFor(lines),
        lines,
        reward: fries,
        productId: 'frites',
        balance: 640,
      }),
    ).toEqual({
      ok: false,
      error: 'reward_product_missing',
    });
    const withFries = [line('frites', 350)];
    expect(
      applyReward({
        totals: totalsFor(withFries),
        lines: withFries,
        reward: fries,
        productId: 'frites',
        balance: 399,
      }),
    ).toEqual({ ok: false, error: 'insufficient_points' });
  });

  it('garde les frais de livraison et exige un reste à payer encaissable', () => {
    const lines = [line('frites', 2000)];
    const r = applyReward({
      totals: totalsFor(lines, 'delivery'),
      lines,
      reward: fries,
      productId: 'frites',
      balance: 1000,
    });
    expect(r.ok && r.totals.totalCents).toBe(299);
    // Seulement le produit offert, à emporter : rien à payer, donc refusé.
    const alone = [line('frites', 350)];
    expect(
      applyReward({
        totals: totalsFor(alone),
        lines: alone,
        reward: fries,
        productId: 'frites',
        balance: 1000,
      }),
    ).toEqual({
      ok: false,
      error: 'reward_needs_paid_items',
    });
    // 0,50 € restant : accepté.
    const withExtra = [line('frites', 350), line('sauce', 50)];
    expect(
      applyReward({
        totals: totalsFor(withExtra),
        lines: withExtra,
        reward: fries,
        productId: 'frites',
        balance: 1000,
      }).ok,
    ).toBe(true);
  });
});

describe('paliers de cadeaux au choix', () => {
  it('offre le produit choisi parmi ceux du palier', () => {
    const lines = [line('burger', 1490), line('onion-rings', 420)];
    const r = applyReward({
      totals: totalsFor(lines),
      lines,
      reward: fries,
      productId: 'onion-rings',
      balance: 400,
    });
    expect(r).toMatchObject({ ok: true, discountCents: 420 });
  });

  it('refuse un produit qui ne fait pas partie du palier', () => {
    const lines = [line('burger', 1490)];
    expect(
      applyReward({
        totals: totalsFor(lines),
        lines,
        reward: fries,
        productId: 'burger',
        balance: 900,
      }),
    ).toEqual({ ok: false, error: 'reward_product_not_eligible' });
  });

  it('indique le prochain palier et les points manquants', () => {
    const tiers = [
      { id: 'b', costPoints: 500 },
      { id: 'a', costPoints: 400 },
      { id: 'c', costPoints: 900 },
    ];
    expect(nextReward(tiers, 120)).toEqual({
      reward: { id: 'a', costPoints: 400 },
      missingPoints: 280,
    });
    expect(nextReward(tiers, 450)).toEqual({
      reward: { id: 'b', costPoints: 500 },
      missingPoints: 50,
    });
    expect(nextReward(tiers, 900)).toBeNull();
  });
});

describe('points réservés par les commandes en cours', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('une commande sur place confirmée réserve les points de son cadeau', () => {
    expect(
      reservedRewardPoints([{ status: 'confirmed', points: 400, createdAt: ago(0) }], now),
    ).toBe(400);
  });

  it('additionne les commandes en cours, payées ou en préparation', () => {
    const holds = [
      { status: 'paid', points: 400, createdAt: ago(0) },
      { status: 'preparing', points: 500, createdAt: ago(0) },
      { status: 'out_for_delivery', points: 100, createdAt: ago(0) },
    ] as const;
    expect(reservedRewardPoints(holds, now)).toBe(1000);
  });

  it('ne réserve plus rien pour une commande terminée, annulée, remboursée ou en échec', () => {
    const holds = (['completed', 'cancelled', 'refunded', 'payment_failed'] as const).map(
      (status) => ({ status, points: 400, createdAt: ago(0) }),
    );
    expect(reservedRewardPoints(holds, now)).toBe(0);
  });

  it('une commande impayée ne réserve que pendant le délai de paiement', () => {
    expect(
      reservedRewardPoints(
        [
          { status: 'pending_payment', points: 400, createdAt: ago(PENDING_PAYMENT_HOLD_MS - 1) },
          { status: 'pending_payment', points: 500, createdAt: ago(PENDING_PAYMENT_HOLD_MS) },
        ],
        now,
      ),
    ).toBe(400);
  });

  it('les points disponibles ne descendent jamais sous zéro', () => {
    expect(availablePoints(450, 400)).toBe(50);
    expect(availablePoints(300, 400)).toBe(0);
  });
});
