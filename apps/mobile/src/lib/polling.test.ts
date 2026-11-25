import { describe, expect, it } from 'vitest';
import { readinessInterval, trackingInterval } from './polling';

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

  it('ralentit après une erreur et arrête le bandeau d’une commande au paiement échoué', () => {
    expect(trackingInterval('paid', { failed: true })).toBe(60_000);
    expect(trackingInterval('payment_failed', { bannerOnly: true })).toBe(false);
    expect(trackingInterval('confirmed', { bannerOnly: true })).toBe(30_000);
  });

  it('attend la caisse chaque seconde, et s’arrête sur réponse ou erreur', () => {
    expect(readinessInterval(undefined, false)).toBe(1000);
    expect(readinessInterval('waiting', false)).toBe(1000);
    expect(readinessInterval('ready', false)).toBe(false);
    expect(readinessInterval('unavailable', false)).toBe(false);
    expect(readinessInterval('waiting', true)).toBe(false);
  });
});
