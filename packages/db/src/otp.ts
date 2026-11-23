import type { Sql } from './client';

/** Code de connexion du client tel que conservé (lot 10, ADR 0012). Le code n'est jamais stocké. */
export interface OtpChallengeRecord {
  readonly id: string;
  readonly codeHash: string;
  readonly createdAt: Date;
  readonly attempts: number;
  readonly verifiedAt: Date | null;
  readonly consumedAt: Date | null;
}

export interface OtpStore {
  /** Dates d'envoi au même identifiant depuis `since` (limite d'envois). */
  recentSends(tenantId: string, identifier: string, since: Date): Promise<Date[]>;
  create(
    tenantId: string,
    input: {
      readonly channel: 'sms' | 'email';
      readonly identifier: string;
      readonly codeHash: string;
      readonly expiresAt: Date;
    },
  ): Promise<void>;
  /** Dernier code envoyé à cet identifiant par ce canal. */
  latest(
    tenantId: string,
    channel: 'sms' | 'email',
    identifier: string,
  ): Promise<OtpChallengeRecord | null>;
  /**
   * Compte un essai, sous condition qu'il en reste ; `verified` marque le code comme validé.
   * Renvoie false si le plafond d'essais était déjà atteint (essais concurrents).
   */
  recordAttempt(id: string, maxAttempts: number, verified: boolean): Promise<boolean>;
  /** Usage unique : true pour le seul appel qui consomme le code. */
  consume(id: string): Promise<boolean>;
}

interface Row {
  id: string;
  code_hash: string;
  created_at: Date;
  attempts: number;
  verified_at: Date | null;
  consumed_at: Date | null;
}

export function createPostgresOtpStore(sql: Sql): OtpStore {
  return {
    async recentSends(tenantId, identifier, since) {
      const rows = await sql<{ created_at: Date }[]>`
        select created_at from public.customer_otp_challenges
        where tenant_id = ${tenantId} and identifier = ${identifier} and created_at > ${since}
        order by created_at desc limit 50`;
      return rows.map((r) => r.created_at);
    },

    async create(tenantId, input) {
      await sql`
        insert into public.customer_otp_challenges (tenant_id, channel, identifier, code_hash, expires_at)
        values (${tenantId}, ${input.channel}, ${input.identifier}, ${input.codeHash}, ${input.expiresAt})`;
    },

    async latest(tenantId, channel, identifier) {
      const [r] = await sql<Row[]>`
        select id, code_hash, created_at, attempts, verified_at, consumed_at
        from public.customer_otp_challenges
        where tenant_id = ${tenantId} and channel = ${channel} and identifier = ${identifier}
        order by created_at desc, id desc limit 1`;
      return r
        ? {
            id: r.id,
            codeHash: r.code_hash,
            createdAt: r.created_at,
            attempts: r.attempts,
            verifiedAt: r.verified_at,
            consumedAt: r.consumed_at,
          }
        : null;
    },

    async recordAttempt(id, maxAttempts, verified) {
      const r = await sql`
        update public.customer_otp_challenges set
          attempts = attempts + 1,
          verified_at = case when ${verified} then coalesce(verified_at, now()) else verified_at end
        where id = ${id} and consumed_at is null and attempts < ${maxAttempts}`;
      return r.count === 1;
    },

    async consume(id) {
      const r = await sql`
        update public.customer_otp_challenges set consumed_at = now()
        where id = ${id} and consumed_at is null`;
      return r.count === 1;
    },
  };
}

/** Même contrat en mémoire (tests de l'API). */
export function createMemoryOtpStore(now: () => Date = () => new Date()): OtpStore & {
  readonly rows: (OtpChallengeRecord & { tenantId: string; channel: string; identifier: string })[];
} {
  type R = {
    id: string;
    tenantId: string;
    channel: string;
    identifier: string;
    codeHash: string;
    createdAt: Date;
    attempts: number;
    verifiedAt: Date | null;
    consumedAt: Date | null;
  };
  const rows: R[] = [];
  let seq = 0;
  return {
    rows,
    recentSends(tenantId, identifier, since) {
      return Promise.resolve(
        rows
          .filter(
            (r) => r.tenantId === tenantId && r.identifier === identifier && r.createdAt > since,
          )
          .map((r) => r.createdAt),
      );
    },
    create(tenantId, input) {
      seq += 1;
      rows.push({
        id: `otp-${seq}`,
        tenantId,
        channel: input.channel,
        identifier: input.identifier,
        codeHash: input.codeHash,
        createdAt: now(),
        attempts: 0,
        verifiedAt: null,
        consumedAt: null,
      });
      return Promise.resolve();
    },
    latest(tenantId, channel, identifier) {
      const r = [...rows]
        .reverse()
        .find(
          (x) => x.tenantId === tenantId && x.channel === channel && x.identifier === identifier,
        );
      return Promise.resolve(r ? { ...r } : null);
    },
    recordAttempt(id, maxAttempts, verified) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumedAt || r.attempts >= maxAttempts) return Promise.resolve(false);
      r.attempts += 1;
      if (verified && !r.verifiedAt) r.verifiedAt = now();
      return Promise.resolve(true);
    },
    consume(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumedAt) return Promise.resolve(false);
      r.consumedAt = now();
      return Promise.resolve(true);
    },
  };
}
