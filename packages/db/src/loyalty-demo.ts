import type { Sql } from './client';

/**
 * Données de test de la fidélité (tables loyalty_demo_*), en attendant l'API Splash360 (ADR 0009).
 * Même contrat que `DemoLoyaltyStore` de `@splash360/api-loyalty`.
 */
export interface DemoMemberRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly points: number;
  readonly cardCode: string;
}

export interface DemoMovementRecord {
  readonly kind: 'welcome' | 'earn' | 'redeem';
  readonly points: number;
  readonly label: string;
  readonly at: string;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  points: number;
  card_code: string;
}

const toMember = (r: MemberRow): DemoMemberRecord => ({
  id: r.id,
  name: r.name,
  email: r.email,
  points: r.points,
  cardCode: r.card_code,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresDemoLoyaltyStore(sql: Sql) {
  return {
    async createMember(
      tenantId: string,
      input: {
        readonly name: string;
        readonly email: string;
        readonly phone: string | null;
        readonly cardCode: string;
        readonly welcomePoints: number;
      },
    ) {
      return sql.begin(async (tx) => {
        const [created] = await tx<MemberRow[]>`
          insert into public.loyalty_demo_members (tenant_id, email, name, phone, points, card_code)
          values (${tenantId}, ${input.email}, ${input.name}, ${input.phone}, ${input.welcomePoints}, ${input.cardCode})
          on conflict (tenant_id, email) do nothing
          returning id, name, email, points, card_code`;
        if (created) {
          if (input.welcomePoints > 0) {
            await tx`insert into public.loyalty_demo_movements (tenant_id, member_id, kind, points, label)
                     values (${tenantId}, ${created.id}, 'welcome', ${input.welcomePoints}, 'Points de bienvenue')`;
          }
          return { member: toMember(created), created: true };
        }
        const [existing] = await tx<MemberRow[]>`
          select id, name, email, points, card_code from public.loyalty_demo_members
          where tenant_id = ${tenantId} and email = ${input.email}`;
        if (!existing) throw new Error('Membre introuvable après conflit');
        return { member: toMember(existing), created: false };
      });
    },

    async findByEmail(tenantId: string, email: string) {
      const [r] = await sql<MemberRow[]>`
        select id, name, email, points, card_code from public.loyalty_demo_members
        where tenant_id = ${tenantId} and email = ${email}`;
      return r ? toMember(r) : null;
    },

    async getMember(tenantId: string, memberId: string) {
      if (!UUID.test(memberId)) return null;
      const [r] = await sql<MemberRow[]>`
        select id, name, email, points, card_code from public.loyalty_demo_members
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
  };
}
