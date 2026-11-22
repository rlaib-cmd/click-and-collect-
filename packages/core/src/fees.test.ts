import { describe, expect, it } from 'vitest';
import { computeApplicationFee, computeTotals, type FeeSettings } from './fees';
import { cents } from './money';

const settings: FeeSettings = {
  deliveryMinimumCents: cents(1500),
  freeDeliveryThresholdCents: cents(3500),
  serviceFeeCents: cents(50),
};

describe('frais et minimum', () => {
  it('à emporter : ni frais de livraison ni minimum', () => {
    expect(computeTotals({ mode: 'pickup', subtotalCents: cents(800), settings })).toEqual({
      ok: true,
      totals: {
        subtotalCents: 800,
        deliveryFeeCents: 0,
        serviceFeeCents: 50,
        discountCents: 0,
        totalCents: 850,
      },
    });
  });

  it('livraison : frais de la zone sous le seuil', () => {
    const r = computeTotals({
      mode: 'delivery',
      subtotalCents: cents(2000),
      settings,
      zoneFeeCents: cents(290),
    });
    expect(r).toEqual({
      ok: true,
      totals: {
        subtotalCents: 2000,
        deliveryFeeCents: 290,
        serviceFeeCents: 50,
        discountCents: 0,
        totalCents: 2340,
      },
    });
  });

  it('livraison offerte à partir du seuil (inclus)', () => {
    const r = computeTotals({
      mode: 'delivery',
      subtotalCents: cents(3500),
      settings,
      zoneFeeCents: cents(290),
    });
    expect(r.ok && r.totals.deliveryFeeCents).toBe(0);
  });

  it('jamais offerte sans seuil', () => {
    const r = computeTotals({
      mode: 'delivery',
      subtotalCents: cents(100_000),
      settings: { ...settings, freeDeliveryThresholdCents: null },
      zoneFeeCents: cents(290),
    });
    expect(r.ok && r.totals.deliveryFeeCents).toBe(290);
  });

  it('bloque sous le minimum de livraison et indique le montant manquant', () => {
    expect(
      computeTotals({
        mode: 'delivery',
        subtotalCents: cents(1200),
        settings,
        zoneFeeCents: cents(290),
      }),
    ).toEqual({ ok: false, error: 'below_delivery_minimum', missingCents: 300 });
  });

  it('exige les frais de zone en livraison', () => {
    expect(() =>
      computeTotals({ mode: 'delivery', subtotalCents: cents(2000), settings }),
    ).toThrow();
  });
});

describe('commission Splash360', () => {
  it('applique pourcentage et montant fixe, arrondis au centime', () => {
    expect(computeApplicationFee(cents(2290), { bps: 250, fixedCents: cents(0) })).toBe(57); // 2,5 % de 22,90 €
    expect(computeApplicationFee(cents(2290), { bps: 0, fixedCents: cents(30) })).toBe(30);
    expect(computeApplicationFee(cents(2290), { bps: 100, fixedCents: cents(20) })).toBe(43);
  });

  it('vaut 0 par défaut et ne dépasse jamais le total', () => {
    expect(computeApplicationFee(cents(2290), { bps: 0, fixedCents: cents(0) })).toBe(0);
    expect(computeApplicationFee(cents(20), { bps: 0, fixedCents: cents(50) })).toBe(20);
  });

  it('refuse un taux invalide', () => {
    expect(() => computeApplicationFee(cents(100), { bps: -1, fixedCents: cents(0) })).toThrow(
      RangeError,
    );
  });
});
