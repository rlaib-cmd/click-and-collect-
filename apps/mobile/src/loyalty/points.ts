import type { LoyaltyMemberDto } from '@splash360/contracts';

/** Points utilisables pour un cadeau : le solde moins ce que réservent les commandes en cours. */
export function usablePoints(member: Pick<LoyaltyMemberDto, 'points' | 'reservedPoints'>): number {
  return Math.max(0, member.points - member.reservedPoints);
}

interface CatalogProduct {
  readonly id: string;
  readonly available: boolean;
}
interface CatalogCategory<P extends CatalogProduct> {
  readonly id: string;
  readonly products: readonly P[];
}

/**
 * Produits d'un palier présents sur la carte (lot 16) : ceux listés par le palier, dans son ordre,
 * puis tous les produits disponibles de ses catégories (toutes les boissons, tous les desserts…),
 * sans doublon.
 */
export function rewardProducts<P extends CatalogProduct>(
  reward: { readonly productIds: readonly string[]; readonly categoryIds?: readonly string[] },
  categories: readonly CatalogCategory<P>[],
): P[] {
  const byId = new Map(categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)));
  const out: P[] = [];
  const seen = new Set<string>();
  const push = (p: P | undefined) => {
    if (p && p.available && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  };
  reward.productIds.forEach((id) => push(byId.get(id)));
  const wanted = new Set(reward.categoryIds ?? []);
  categories.filter((c) => wanted.has(c.id)).forEach((c) => c.products.forEach(push));
  return out;
}

/** Palier mis en avant à l'entrée du click & collect (lot 16). */
export type TierHighlight<R> =
  | { readonly kind: 'unlocked'; readonly reward: R; readonly points: number }
  | { readonly kind: 'next'; readonly reward: R; readonly missing: number; readonly points: number }
  | null;

/**
 * Le palier débloqué le plus généreux (le plus de points), sinon le prochain à atteindre avec ce
 * qu'il manque. null sans palier.
 */
export function tierHighlight<R extends { readonly costPoints: number }>(
  rewards: readonly R[],
  points: number,
): TierHighlight<R> {
  const sorted = [...rewards].sort((a, b) => a.costPoints - b.costPoints);
  const unlocked = sorted.filter((r) => r.costPoints <= points).at(-1);
  if (unlocked) return { kind: 'unlocked', reward: unlocked, points };
  const next = sorted.find((r) => r.costPoints > points);
  return next ? { kind: 'next', reward: next, missing: next.costPoints - points, points } : null;
}
