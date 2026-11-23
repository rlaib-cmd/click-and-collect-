import { describe, expect, it } from 'vitest';
import type { Totals } from './fees';
import { cents } from './money';
import { applyPromo, normalizePromoCode, validatePromoDefinition, type PromoCode } from './promo';

const now = new Date('2026-11-23T12:00:00Z');
const totals = (subtotal: number, delivery = 0, reward = 0): Totals => ({
  subtotalCents: cents(subtotal),
  deliveryFeeCents: cents(delivery),
  serviceFeeCents: cents(0),
  discountCents: cents(reward),
  promoDiscountCents: cents(0),
  totalCents: cents(subtotal + delivery - reward),
});
const promo = (p: Partial<PromoCode> = {}): PromoCode => ({
  code: 'BIENVENUE',
  kind: 'percent',
  value: 10,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  active: true,
  ...p,
});
const apply = (
  t: Totals,
  p: PromoCode | null,
  extra: { uses?: number; alreadyUsed?: boolean } = {},
) =>
  applyPromo({
    totals: t,
    promo: p,
    now,
    uses: extra.uses ?? 0,
    alreadyUsed: extra.alreadyUsed ?? false,
  });

describe('codes promo', () => {
  it('normalise la saisie et refuse un code mal formé', () => {
    expect(normalizePromoCode(' bien venue ')).toBe('BIENVENUE');
    expect(normalizePromoCode('ab')).toBeNull();
    expect(normalizePromoCode('promo!')).toBeNull();
  });

  it('pourcentage sur les articles, arrondi à l’inférieur, frais non remisés', () => {
    const r = apply(totals(2390, 299), promo({ value: 10 }));
    expect(r).toMatchObject({ ok: true, promoDiscountCents: 239 });
    if (r.ok) expect(r.totals.totalCents).toBe(2390 + 299 - 239);
  });

  it('s’applique après la récompense fidélité', () => {
    const r = apply(totals(2000, 0, 350), promo({ value: 50 }));
    expect(r).toMatchObject({ ok: true, promoDiscountCents: 825 });
  });

  it('montant fixe plafonné aux articles, et jamais une commande gratuite', () => {
    expect(apply(totals(2000), promo({ kind: 'fixed', value: 300 }))).toMatchObject({
      ok: true,
      promoDiscountCents: 300,
    });
    expect(apply(totals(400), promo({ kind: 'fixed', value: 1000 }))).toEqual({
      ok: false,
      error: 'promo_needs_paid_amount',
    });
    expect(apply(totals(400, 299), promo({ kind: 'fixed', value: 1000 }))).toMatchObject({
      ok: true,
      promoDiscountCents: 400,
    });
  });

  it('refuse un code inconnu, désactivé, pas commencé ou expiré', () => {
    expect(apply(totals(2000), null)).toEqual({ ok: false, error: 'promo_invalid' });
    expect(apply(totals(2000), promo({ active: false }))).toEqual({
      ok: false,
      error: 'promo_invalid',
    });
    expect(apply(totals(2000), promo({ startsAt: new Date('2026-12-01') }))).toEqual({
      ok: false,
      error: 'promo_not_started',
    });
    expect(apply(totals(2000), promo({ endsAt: now }))).toEqual({
      ok: false,
      error: 'promo_expired',
    });
  });

  it('minimum de commande, nombre d’utilisations et une fois par client', () => {
    expect(apply(totals(1500), promo({ minSubtotalCents: 2000 }))).toEqual({
      ok: false,
      error: 'promo_min_subtotal',
    });
    expect(apply(totals(2000), promo({ maxUses: 100 }), { uses: 100 })).toEqual({
      ok: false,
      error: 'promo_exhausted',
    });
    expect(apply(totals(2000), promo(), { alreadyUsed: true })).toEqual({
      ok: false,
      error: 'promo_already_used',
    });
  });

  it('contrôle la définition d’un code au back-office', () => {
    expect(validatePromoDefinition(promo())).toBeNull();
    expect(validatePromoDefinition(promo({ value: 150 }))).toBe('value');
    expect(validatePromoDefinition(promo({ kind: 'fixed', value: 0 }))).toBe('value');
    expect(validatePromoDefinition(promo({ maxUses: 0 }))).toBe('maxUses');
    expect(validatePromoDefinition(promo({ startsAt: now, endsAt: new Date('2026-01-01') }))).toBe(
      'dates',
    );
  });
});
