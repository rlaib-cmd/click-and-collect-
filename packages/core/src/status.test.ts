import { describe, expect, it } from 'vitest';
import {
  checkPaymentMethod,
  checkTransition,
  isFinished,
  missingForOnlinePayment,
  ONLINE_PAYMENT_MINIMUM_CENTS,
} from './status';

describe('changements de statut', () => {
  it('avance dans le parcours, en sautant éventuellement des étapes', () => {
    expect(checkTransition('pickup', 'paid', 'accepted')).toEqual({ ok: true });
    expect(checkTransition('pickup', 'paid', 'ready')).toEqual({ ok: true });
    expect(checkTransition('delivery', 'ready', 'out_for_delivery')).toEqual({ ok: true });
    expect(checkTransition('delivery', 'out_for_delivery', 'completed')).toEqual({ ok: true });
  });

  it('ne revient jamais en arrière', () => {
    expect(checkTransition('pickup', 'ready', 'preparing')).toEqual({
      ok: false,
      error: 'backwards',
    });
    expect(checkTransition('pickup', 'accepted', 'accepted')).toEqual({
      ok: false,
      error: 'backwards',
    });
  });

  it('refuse « en livraison » pour un retrait', () => {
    expect(checkTransition('pickup', 'ready', 'out_for_delivery')).toEqual({
      ok: false,
      error: 'invalid_for_mode',
    });
  });

  it('exige une commande payée et non terminée', () => {
    expect(checkTransition('pickup', 'pending_payment', 'accepted')).toEqual({
      ok: false,
      error: 'not_paid',
    });
    expect(checkTransition('pickup', 'completed', 'cancelled')).toEqual({
      ok: false,
      error: 'finished',
    });
    expect(checkTransition('pickup', 'refunded', 'accepted')).toEqual({
      ok: false,
      error: 'finished',
    });
  });

  it('permet d’annuler une commande payée non remise', () => {
    expect(checkTransition('delivery', 'out_for_delivery', 'cancelled')).toEqual({ ok: true });
  });

  it('reconnaît les statuts terminés', () => {
    expect(isFinished('completed')).toBe(true);
    expect(isFinished('ready')).toBe(false);
  });
});

describe('paiement sur place', () => {
  it('une commande confirmée (à payer sur place) suit le parcours comme une commande payée', () => {
    expect(checkTransition('pickup', 'confirmed', 'accepted')).toEqual({ ok: true });
    expect(checkTransition('pickup', 'confirmed', 'completed')).toEqual({ ok: true });
    expect(checkTransition('delivery', 'confirmed', 'out_for_delivery')).toEqual({ ok: true });
    expect(checkTransition('pickup', 'confirmed', 'cancelled')).toEqual({ ok: true });
  });

  it('choix du moyen de paiement', () => {
    const base = { onlineAvailable: true, onSiteEnabled: true, isMember: true };
    expect(checkPaymentMethod({ ...base, method: 'online' })).toEqual({ ok: true });
    expect(checkPaymentMethod({ ...base, method: 'online', onlineAvailable: false })).toEqual({
      ok: false,
      error: 'payment_method_unavailable',
    });
    expect(checkPaymentMethod({ ...base, method: 'on_site' })).toEqual({ ok: true });
    expect(checkPaymentMethod({ ...base, method: 'on_site', onSiteEnabled: false })).toEqual({
      ok: false,
      error: 'payment_method_unavailable',
    });
    // Réservé aux membres du club, même si le restaurant l'accepte.
    expect(checkPaymentMethod({ ...base, method: 'on_site', isMember: false })).toEqual({
      ok: false,
      error: 'on_site_requires_member',
    });
  });
});

describe('paiement en ligne : minimum de Stripe (0,50 €)', () => {
  it('refuse un montant positif sous 0,50 € et indique ce qui manque', () => {
    expect(missingForOnlinePayment(10)).toBe(40);
    expect(missingForOnlinePayment(49)).toBe(1);
  });
  it('accepte 0,50 € et plus, et une commande entièrement offerte', () => {
    expect(missingForOnlinePayment(ONLINE_PAYMENT_MINIMUM_CENTS)).toBeNull();
    expect(missingForOnlinePayment(1290)).toBeNull();
    expect(missingForOnlinePayment(0)).toBeNull();
  });
});
