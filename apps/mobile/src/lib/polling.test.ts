import { describe, expect, it } from 'vitest';
import { trackingInterval } from './polling';

describe('rythme du suivi de commande', () => {
  it('suit de près le paiement, ralentit ensuite et s’arrête à la fin', () => {
    expect(trackingInterval(undefined)).toBe(4000);
    expect(trackingInterval('pending_payment')).toBe(4000);
    expect(trackingInterval('payment_failed')).toBe(4000);
    expect(trackingInterval('paid')).toBe(30_000);
    expect(trackingInterval('confirmed')).toBe(30_000);
    expect(trackingInterval('preparing')).toBe(30_000);
    expect(trackingInterval('completed')).toBe(false);
    expect(trackingInterval('cancelled')).toBe(false);
    expect(trackingInterval('refunded')).toBe(false);
  });
});
