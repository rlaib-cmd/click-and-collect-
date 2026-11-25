import type { Sql } from './client';

/**
 * Version de session des membres du club (audit du 25/11, M4) : incrémentée à chaque connexion
 * confirmée par code ; un jeton d'une version antérieure est refusé.
 */
export interface MemberSessionStore {
  current(tenantId: string, memberId: string): Promise<number>;
  /** Nouvelle version (connexion confirmée) : les jetons précédents deviennent invalides. */
  bump(tenantId: string, memberId: string): Promise<number>;
}

export function createPostgresMemberSessionStore(sql: Sql): MemberSessionStore {
  return {
    async current(tenantId, memberId) {
      const [r] = await sql<{ version: number }[]>`
        select version from public.loyalty_member_sessions
        where tenant_id = ${tenantId} and member_id = ${memberId}`;
      return r?.version ?? 0;
    },
    async bump(tenantId, memberId) {
      const [r] = await sql<{ version: number }[]>`
        insert into public.loyalty_member_sessions (tenant_id, member_id, version)
        values (${tenantId}, ${memberId}, 1)
        on conflict (tenant_id, member_id)
        do update set version = public.loyalty_member_sessions.version + 1, updated_at = now()
        returning version`;
      return r?.version ?? 1;
    },
  };
}

export function createMemoryMemberSessionStore(): MemberSessionStore {
  const versions = new Map<string, number>();
  return {
    current: (tenantId, memberId) => Promise.resolve(versions.get(`${tenantId}:${memberId}`) ?? 0),
    bump(tenantId, memberId) {
      const key = `${tenantId}:${memberId}`;
      const next = (versions.get(key) ?? 0) + 1;
      versions.set(key, next);
      return Promise.resolve(next);
    },
  };
}
