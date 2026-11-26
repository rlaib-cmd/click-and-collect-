import type { Totals } from './fees';
import { MIN_CHARGE_CENTS } from './loyalty';
import { cents, type Cents } from './money';

/** Code promo d'une enseigne, créé dans le back-office (lot 11, ADR 0015). */
export interface PromoCode {
  readonly code: string;
  /** `percent` : value en pourcentage (1 à 100) ; `fixed` : value en centimes. */
  readonly kind: 'percent' | 'fixed';
  readonly value: number;
  /** Sous-total minimum des articles (avant remises), en centimes. */
  readonly minSubtotalCents: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** Nombre total d'utilisations permises ; null = illimité. */
  readonly maxUses: number | null;
  readonly active: boolean;
}

export type PromoError =
  | 'promo_invalid'
  | 'promo_not_started'
  | 'promo_expired'
  | 'promo_min_subtotal'
  | 'promo_exhausted'
  | 'promo_already_used'
  | 'promo_needs_paid_amount';

export type PromoResult =
  | { readonly ok: true; readonly totals: Totals; readonly promoDiscountCents: Cents }
  | { readonly ok: false; readonly error: PromoError };

const CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;

/** Saisie du client ramenée à la forme stockée : majuscules, sans espaces ; null si mal formée. */
export function normalizePromoCode(input: string): string | null {
  const code = input.replace(/\s+/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

/** Contrôle d'un code à la création dans le back-office. */
export function validatePromoDefinition(p: PromoCode): string | null {
  if (!CODE.test(p.code)) return 'code';
  if (!Number.isSafeInteger(p.value) || p.value <= 0) return 'value';
  if (p.kind === 'percent' && p.value > 100) return 'value';
  if (!Number.isSafeInteger(p.minSubtotalCents) || p.minSubtotalCents < 0) return 'minSubtotal';
  if (p.maxUses !== null && (!Number.isSafeInteger(p.maxUses) || p.maxUses < 1)) return 'maxUses';
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) return 'dates';
  return null;
}

/**
 * Applique un code promo aux totaux (après la récompense fidélité) :
 * - pourcentage du sous-total des articles moins la récompense et les remises articles des
 *   promotions de catalogue (lot 24), arrondi à l'inférieur ;
 * - montant fixe plafonné à ce même montant ;
 * - les frais (livraison, service) ne sont jamais remisés ;
 * - il doit rester au moins `MIN_CHARGE_CENTS` à payer (une commande n'est jamais gratuite).
 */
export function applyPromo(input: {
  readonly totals: Totals;
  readonly promo: PromoCode | null;
  readonly now: Date;
  /** Utilisations déjà enregistrées pour ce code. */
  readonly uses: number;
  /** Le client (ou membre) a déjà utilisé ce code. */
  readonly alreadyUsed: boolean;
}): PromoResult {
  const { totals, promo, now, uses, alreadyUsed } = input;
  if (!promo || !promo.active) return { ok: false, error: 'promo_invalid' };
  if (promo.startsAt && now < promo.startsAt) return { ok: false, error: 'promo_not_started' };
  if (promo.endsAt && now >= promo.endsAt) return { ok: false, error: 'promo_expired' };
  if (totals.subtotalCents < promo.minSubtotalCents)
    return { ok: false, error: 'promo_min_subtotal' };
  if (promo.maxUses !== null && uses >= promo.maxUses)
    return { ok: false, error: 'promo_exhausted' };
  if (alreadyUsed) return { ok: false, error: 'promo_already_used' };
  const base = Math.max(
    0,
    totals.subtotalCents - totals.discountCents - totals.catalogDiscountCents,
  );
  const raw = promo.kind === 'percent' ? Math.floor((base * promo.value) / 100) : promo.value;
  const promoDiscountCents = cents(Math.min(raw, base));
  const totalCents = totals.totalCents - promoDiscountCents;
  if (totalCents < MIN_CHARGE_CENTS) return { ok: false, error: 'promo_needs_paid_amount' };
  return {
    ok: true,
    promoDiscountCents,
    totals: { ...totals, promoDiscountCents, totalCents: cents(totalCents) },
  };
}
