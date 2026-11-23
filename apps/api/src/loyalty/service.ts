import { Buffer } from 'node:buffer';
import type {
  LoyaltyMember,
  LoyaltyProgram,
  LoyaltyProvider,
  LoyaltyTenant,
} from '@splash360/api-loyalty';
import type { LoyaltyMemberDto } from '@splash360/contracts';
import { availablePoints } from '@splash360/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface LoyaltyDeps {
  readonly loyalty?: LoyaltyProvider | undefined;
  /** Clé de signature des jetons (même secret que les jetons de suivi, autre usage). */
  readonly tokenSecret: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(secret: string, tenantId: string, memberId: string): string {
  return createHmac('sha256', secret).update(`loyalty:${tenantId}:${memberId}`).digest('base64url');
}

/**
 * Jeton du membre, remis à l'adhésion ou à la connexion : « <identifiant>_<signature> ».
 * Lié à l'enseigne : inutilisable dans une autre.
 */
export function memberToken(secret: string, tenantId: string, memberId: string): string {
  return `${memberId}_${signature(secret, tenantId, memberId)}`;
}

/** Identifiant du membre si le jeton est valide pour cette enseigne, sinon null. */
export function verifyMemberToken(
  secret: string,
  tenantId: string,
  token: string | undefined,
): string | null {
  if (!token) return null;
  const i = token.indexOf('_');
  if (i <= 0) return null;
  const memberId = token.slice(0, i);
  if (!UUID.test(memberId)) return null;
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(signature(secret, tenantId, memberId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? memberId : null;
}

export async function memberView(
  provider: LoyaltyProvider,
  tenant: LoyaltyTenant,
  program: LoyaltyProgram,
  member: LoyaltyMember,
  /** Points réservés par les commandes en cours (ADR 0013). */
  reservedPoints = 0,
): Promise<LoyaltyMemberDto> {
  const usable = availablePoints(member.points, reservedPoints);
  const next = [...program.rewards]
    .sort((a, b) => a.costPoints - b.costPoints)
    .find((r) => r.costPoints > usable);
  return {
    name: member.name,
    email: member.email,
    phone: member.phone,
    points: member.points,
    reservedPoints,
    cardCode: member.cardCode,
    nextReward: next
      ? {
          name: next.name,
          costPoints: next.costPoints,
          missingPoints: next.costPoints - usable,
        }
      : null,
    history: [...(await provider.history(tenant, member.id))],
  };
}
