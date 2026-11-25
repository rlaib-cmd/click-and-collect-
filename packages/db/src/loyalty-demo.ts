import type { Sql } from './client';

/**
 * Données de test de la fidélité (tables loyalty_demo_*), en attendant l'API Splash360 (ADR 0009).
 * Même contrat que `DemoLoyaltyStore` de `@splash360/api-loyalty`.
 */
export interface DemoMemberRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly points: number;
  readonly cardCode: string;
  /** Date de naissance (AAAA-MM-JJ), facultative (lot 16). */
  readonly birthDate: string | null;
}

export interface DemoMovementRecord {
  readonly kind: 'welcome' | 'earn' | 'redeem' | 'adjust';
  readonly points: number;
  readonly label: string;
  readonly at: string;
}

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  card_code: string;
  birth_date: Date | string | null;
}

/** Date SQL → AAAA-MM-JJ, sans décalage de fuseau. */
function isoDate(d: Date | string | null): string | null {
  if (d === null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toMember = (r: MemberRow): DemoMemberRecord => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  points: r.points,
  cardCode: r.card_code,
  birthDate: isoDate(r.birth_date),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresDemoLoyaltyStore(sql: Sql) {
  return {
    async createMember(
      tenantId: string,
      input: {
        readonly name: string;
        readonly email: string | null;
        readonly phone: string | null;
        readonly cardCode: string;
        readonly welcomePoints: number;
      },
    ) {
      return sql.begin(async (tx) => {
        const [created] = await tx<MemberRow[]>`
          insert into public.loyalty_demo_members (tenant_id, email, name, phone, points, card_code)
          values (${tenantId}, ${input.email}, ${input.name}, ${input.phone}, ${input.welcomePoints}, ${input.cardCode})
          on conflict do nothing
          returning id, name, email, phone, points, card_code, birth_date`;
        if (created) {
          if (input.welcomePoints > 0) {
            await tx`insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label)
                     values (${tenantId}, ${created.id}, 'welcome', ${input.welcomePoints}, 'Points de bienvenue')`;
          }
          return { member: toMember(created), created: true };
        }
        const [existing] = await tx<MemberRow[]>`
          select id, name, email, phone, points, card_code, birth_date from public.loyalty_demo_members
          where tenant_id = ${tenantId}
            and ((${input.phone}::text is not null and phone = ${input.phone})
              or (${input.email}::text is not null and email = ${input.email}))
          order by (phone is not distinct from ${input.phone}) desc limit 1`;
        if (!existing) throw new Error('Membre introuvable après conflit');
        return { member: toMember(existing), created: false };
      });
    },

    async findByEmail(tenantId: string, email: string) {
      const [r] = await sql<MemberRow[]>`
        select id, name, email, phone, points, card_code, birth_date from public.loyalty_demo_members
        where tenant_id = ${tenantId} and email = ${email}`;
      return r ? toMember(r) : null;
    },

    async findByPhone(tenantId: string, phone: string) {
      const [r] = await sql<MemberRow[]>`
        select id, name, email, phone, points, card_code, birth_date from public.loyalty_demo_members
        where tenant_id = ${tenantId} and phone = ${phone}`;
      return r ? toMember(r) : null;
    },

    async getMember(tenantId: string, memberId: string) {
      if (!UUID.test(memberId)) return null;
      const [r] = await sql<MemberRow[]>`
        select id, name, email, phone, points, card_code, birth_date from public.loyalty_demo_members
        where tenant_id = ${tenantId} and id = ${memberId}`;
      return r ? toMember(r) : null;
    },

    async history(tenantId: string, memberId: string): Promise<DemoMovementRecord[]> {
      if (!UUID.test(memberId)) return [];
      const rows = await sql<
        { kind: DemoMovementRecord['kind']; points: number; label: string; created_at: Date }[]
      >`
        select kind, points, label, created_at from public.loyalty_demo_movements
        where tenant_id = ${tenantId} and member_id = ${memberId}
        order by created_at desc, id desc limit 50`;
      return rows.map((r) => ({
        kind: r.kind,
        points: r.points,
        label: r.label,
        at: r.created_at.toISOString(),
      }));
    },

    /** Gain et récompense d'une commande, sous verrou du membre ; un rejeu ne change rien. */
    async settle(
      tenantId: string,
      input: {
        readonly memberId: string;
        readonly orderId: string;
        readonly earn: { readonly points: number; readonly label: string } | null;
        readonly redeem: { readonly points: number; readonly label: string } | null;
      },
    ): Promise<
      | { readonly ok: true }
      | { readonly ok: false; readonly error: 'unknown_member' | 'insufficient_points' }
    > {
      if (!UUID.test(input.memberId)) return { ok: false, error: 'unknown_member' };
      return sql.begin(async (tx) => {
        const [m] = await tx<{ points: number }[]>`
          select points from public.loyalty_demo_members
          where tenant_id = ${tenantId} and id = ${input.memberId} for update`;
        if (!m) return { ok: false as const, error: 'unknown_member' as const };
        const done = await tx<{ kind: string }[]>`
          select kind from public.loyalty_demo_movements
          where member_id = ${input.memberId} and order_id = ${input.orderId}`;
        const has = (k: string) => done.some((d) => d.kind === k);
        const redeem = input.redeem && !has('redeem') ? input.redeem : null;
        if (redeem && m.points < redeem.points) {
          return { ok: false as const, error: 'insufficient_points' as const };
        }
        let delta = 0;
        if (redeem) {
          delta -= redeem.points;
          await tx`insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label, order_id)
                   values (${tenantId}, ${input.memberId}, 'redeem', ${-redeem.points}, ${redeem.label}, ${input.orderId})`;
        }
        if (input.earn && !has('earn')) {
          delta += input.earn.points;
          await tx`insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label, order_id)
                   values (${tenantId}, ${input.memberId}, 'earn', ${input.earn.points}, ${input.earn.label}, ${input.orderId})`;
        }
        if (delta !== 0) {
          await tx`update public.loyalty_demo_members set points = points + ${delta}
                   where id = ${input.memberId}`;
        }
        return { ok: true as const };
      });
    },

    async listMembers(tenantId: string, search: string | null, limit: number) {
      const like = search ? `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      const rows = await sql<(MemberRow & { created_at: Date })[]>`
        select id, name, email, phone, points, card_code, birth_date, created_at from public.loyalty_demo_members
        where tenant_id = ${tenantId}
          and (${like}::text is null or lower(name) like ${like} or email like ${like} or phone like ${like} or lower(card_code) like ${like})
        order by created_at desc, id desc limit ${limit}`;
      return rows.map((r) => ({ ...toMember(r), createdAt: r.created_at.toISOString() }));
    },

    /** Correction manuelle du solde, sous verrou ; jamais en dessous de zéro. */
    async adjust(
      tenantId: string,
      memberId: string,
      delta: number,
      label: string,
    ): Promise<
      | { readonly ok: true; readonly member: DemoMemberRecord }
      | { readonly ok: false; readonly error: 'unknown_member' | 'insufficient_points' }
    > {
      if (!UUID.test(memberId)) return { ok: false, error: 'unknown_member' };
      return sql.begin(async (tx) => {
        const [m] = await tx<{ points: number }[]>`
          select points from public.loyalty_demo_members
          where tenant_id = ${tenantId} and id = ${memberId} for update`;
        if (!m) return { ok: false as const, error: 'unknown_member' as const };
        if (m.points + delta < 0)
          return { ok: false as const, error: 'insufficient_points' as const };
        await tx`insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label)
                 values (${tenantId}, ${memberId}, 'adjust', ${delta}, ${label})`;
        const [r] = await tx<MemberRow[]>`
          update public.loyalty_demo_members set points = points + ${delta} where id = ${memberId}
          returning id, name, email, phone, points, card_code, birth_date`;
        if (!r) throw new Error('Membre introuvable');
        return { ok: true as const, member: toMember(r) };
      });
    },

    /** Profil complété par le membre (lot 16) : champs absents inchangés, null pour effacer. */
    async updateProfile(
      tenantId: string,
      memberId: string,
      input: {
        readonly name?: string;
        readonly email?: string | null;
        readonly birthDate?: string | null;
      },
    ): Promise<
      | { readonly ok: true; readonly member: DemoMemberRecord }
      | { readonly ok: false; readonly error: 'unknown_member' | 'email_taken' }
    > {
      if (!UUID.test(memberId)) return { ok: false, error: 'unknown_member' };
      try {
        const [r] = await sql<MemberRow[]>`
          update public.loyalty_demo_members set
            name = coalesce(${input.name ?? null}, name),
            email = case when ${input.email !== undefined} then ${input.email ?? null} else email end,
            birth_date = case when ${input.birthDate !== undefined} then ${input.birthDate ?? null}::date else birth_date end
          where tenant_id = ${tenantId} and id = ${memberId}
          returning id, name, email, phone, points, card_code, birth_date`;
        return r ? { ok: true, member: toMember(r) } : { ok: false, error: 'unknown_member' };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return { ok: false, error: 'email_taken' };
        throw error;
      }
    },

    async deleteMember(tenantId: string, memberId: string) {
      if (!UUID.test(memberId)) return false;
      const r = await sql`delete from public.loyalty_demo_members
                          where tenant_id = ${tenantId} and id = ${memberId}`;
      return r.count === 1;
    },
  };
}
