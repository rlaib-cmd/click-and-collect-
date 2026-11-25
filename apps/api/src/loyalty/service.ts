import { Buffer } from 'node:buffer';
import type {
  LoyaltyMember,
  LoyaltyProgram,
  LoyaltyProvider,
  LoyaltyTenant,
} from '@splash360/api-loyalty';
import type { LoyaltyMemberDto } from '@splash360/contracts';
import type { MemberSessionStore } from '@splash360/db';
import { availablePoints } from '@splash360/core';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface LoyaltyDeps {
  readonly loyalty?: LoyaltyProvider | undefined;
  /** Clé de signature des jetons (même secret que les jetons de suivi, autre usage). */
  readonly tokenSecret: string;
  /** Version de session des membres (audit M4) ; absente : seule l'expiration est contrôlée. */
  readonly memberSessions?: MemberSessionStore | undefined;
  readonly now?: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Durée de vie d'un jeton de membre (audit du 25/11, M4) : reconnexion par code au-delà. */
export const MEMBER_TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`loyalty:${payload}`).digest('base64url');
}

/**
 * Jeton du membre, remis à l'adhésion ou à la connexion :
 * « m2.<identifiant>.<expiration base 36>.<version>.<signature> ». Lié à l'enseigne (inutilisable
 * ailleurs), il expire au bout de 90 jours et devient invalide dès une nouvelle connexion par code.
 */
export function memberToken(
  secret: string,
  tenantId: string,
  memberId: string,
  options: { now?: Date; version?: number } = {},
): string {
  const exp = Math.floor(((options.now ?? new Date()).getTime() + MEMBER_TOKEN_TTL_MS) / 1000);
  const body = `${memberId}.${exp.toString(36)}.${options.version ?? 0}`;
  return `m2.${body}.${signature(secret, `${tenantId}:${body}`)}`;
}

/** Identifiant et version si le jeton est authentique, non expiré et de cette enseigne. */
export function readMemberToken(
  secret: string,
  tenantId: string,
  token: string | undefined,
  now: Date = new Date(),
): { memberId: string; version: number } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'm2') return null;
  const [, memberId = '', expRaw = '', versionRaw = '', sig = ''] = parts;
  if (!UUID.test(memberId) || !/^\d{1,6}$/.test(versionRaw)) return null;
  const body = `${memberId}.${expRaw}.${versionRaw}`;
  const given = Buffer.from(sig);
  const expected = Buffer.from(signature(secret, `${tenantId}:${body}`));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const exp = parseInt(expRaw, 36);
  if (!Number.isFinite(exp) || exp * 1000 <= now.getTime()) return null;
  return { memberId, version: Number(versionRaw) };
}

/**
 * Membre authentifié par son jeton : signature, expiration, enseigne, puis version de session
 * (un jeton antérieur à la dernière connexion par code est refusé).
 */
export async function authenticateMember(
  deps: LoyaltyDeps,
  tenantId: string,
  token: string | undefined,
): Promise<string | null> {
  const read = readMemberToken(deps.tokenSecret, tenantId, token, deps.now?.() ?? new Date());
  if (!read) return null;
  if (deps.memberSessions) {
    const current = await deps.memberSessions.current(tenantId, read.memberId);
    if (read.version !== current) return null;
  }
  return read.memberId;
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
