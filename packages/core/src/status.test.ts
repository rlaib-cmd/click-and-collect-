import { describe, expect, it } from 'vitest';
import { checkTransition, isFinished } from './status';

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
