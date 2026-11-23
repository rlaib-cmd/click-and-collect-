import type { Totals } from './fees';
import { cents, type Cents } from './money';
import type { PricedLine } from './pricing';
import type { OrderStatus } from './status';

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

/** Commande avec récompense dont les points n'ont pas encore été débités chez Splash360. */
export interface RewardHold {
  readonly status: OrderStatus;
  readonly points: number;
  readonly createdAt: Date;
}

/** Une commande en attente de paiement garde ses points réservés le temps de payer. */
export const PENDING_PAYMENT_HOLD_MS = 30 * 60 * 1000;

/** Statuts d'une commande encore en cours, dont la récompense réserve les points. */
const HOLDING: readonly OrderStatus[] = [
  'paid',
  'confirmed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
];

/**
 * Points réservés par les commandes en cours (ADR 0013). Les points d'un cadeau ne sont débités
 * qu'à la validation (paiement en ligne, ou retrait pour le paiement sur place), mais ils ne
 * peuvent pas resservir entre-temps. Une commande terminée, annulée, remboursée ou en échec de
 * paiement ne réserve plus rien ; une commande impayée, seulement pendant `PENDING_PAYMENT_HOLD_MS`.
 */
export function reservedRewardPoints(holds: readonly RewardHold[], now: Date): number {
  return holds.reduce((sum, h) => {
    const holding =
      HOLDING.includes(h.status) ||
      (h.status === 'pending_payment' &&
        now.getTime() - h.createdAt.getTime() < PENDING_PAYMENT_HOLD_MS);
    return holding ? sum + Math.max(0, h.points) : sum;
  }, 0);
}

/** Points utilisables pour une nouvelle récompense : solde moins les réservations. */
export function availablePoints(balance: number, reserved: number): number {
  return Math.max(0, balance - reserved);
}
