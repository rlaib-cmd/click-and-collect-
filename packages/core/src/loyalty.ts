import type { Totals } from './fees';
import { cents, type Cents } from './money';
import type { PricedLine } from './pricing';

/** Programme de fidélité d'une enseigne (règles tenues par Splash360). */
export interface LoyaltyRules {
  /** Points gagnés par euro payé (entier ≥ 0). */
  readonly pointsPerEuro: number;
}

/** Récompense échangeable contre des points : un produit de la carte offert. */
export interface LoyaltyReward {
  readonly id: string;
  readonly name: string;
  readonly costPoints: number;
  /** Produit offert (identifiant de la carte Splash360). */
  readonly productId: string;
}

/**
 * Points gagnés pour un montant payé : arrondi à l'inférieur, jamais négatif.
 * 18,10 € à 10 points par euro = 181 points.
 */
export function pointsForAmount(paidCents: Cents, rules: LoyaltyRules): number {
  if (!Number.isSafeInteger(rules.pointsPerEuro) || rules.pointsPerEuro < 0) {
    throw new RangeError(`Règle de points invalide : ${rules.pointsPerEuro}`);
  }
  if (paidCents <= 0) return 0;
  return Math.floor((paidCents * rules.pointsPerEuro) / 100);
}

export type RewardResult =
  | { readonly ok: true; readonly totals: Totals; readonly discountCents: Cents }
  | {
      readonly ok: false;
      readonly error: 'reward_product_missing' | 'insufficient_points' | 'reward_needs_paid_items';
    };

/** Plus petit montant encaissable par carte (Stripe, en euros) : une commande ne peut pas être gratuite. */
export const MIN_CHARGE_CENTS = cents(50);

/**
 * Applique une récompense « produit offert » : le prix de base d'une unité du produit
 * (sans ses options) est déduit du total. Le produit doit être dans le panier et le
 * solde suffisant, et il doit rester au moins `MIN_CHARGE_CENTS` à payer.
 */
export function applyReward(input: {
  readonly totals: Totals;
  readonly lines: readonly PricedLine[];
  readonly reward: LoyaltyReward;
  readonly balance: number;
}): RewardResult {
  const { totals, lines, reward, balance } = input;
  if (balance < reward.costPoints) return { ok: false, error: 'insufficient_points' };
  const line = lines.find((l) => l.productId === reward.productId && l.quantity > 0);
  if (!line) return { ok: false, error: 'reward_product_missing' };
  const before = totals.subtotalCents + totals.deliveryFeeCents + totals.serviceFeeCents;
  const discountCents = cents(Math.max(0, Math.min(line.basePriceCents, before)));
  // Le reste à payer doit pouvoir être encaissé : la récompense s'ajoute à une commande payante.
  if (before - discountCents < MIN_CHARGE_CENTS)
    return { ok: false, error: 'reward_needs_paid_items' };
  return {
    ok: true,
    discountCents,
    totals: { ...totals, discountCents, totalCents: cents(before - discountCents) },
  };
}
