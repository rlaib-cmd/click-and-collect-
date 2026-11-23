import type { LoyaltyMemberDto } from '@splash360/contracts';

/** Points utilisables pour un cadeau : le solde moins ce que réservent les commandes en cours. */
export function usablePoints(member: Pick<LoyaltyMemberDto, 'points' | 'reservedPoints'>): number {
  return Math.max(0, member.points - member.reservedPoints);
}
