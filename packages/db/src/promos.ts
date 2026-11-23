import type { PromoCode } from '@splash360/core';
import type { Sql } from './client';

/** Code promo vu dans le back-office, avec son nombre d'utilisations (ADR 0015). */
export interface PromoAdminRecord extends PromoCode {
  readonly id: string;
  readonly uses: number;
  readonly createdAt: string;
}

/** Gestion des codes promo d'une enseigne (back-office). */
export interface PromoAdminStore {
  listPromos(tenantId: string): Promise<PromoAdminRecord[]>;
  /** 'conflict' : ce code existe déjà dans l'enseigne. */
  createPromo(tenantId: string, promo: PromoCode): Promise<{ id: string } | 'conflict'>;
  setPromoActive(tenantId: string, promoId: string, active: boolean): Promise<boolean>;
}

interface Row {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  min_subtotal_cents: number;
  starts_at: Date | null;
  ends_at: Date | null;
  max_uses: number | null;
  active: boolean;
  uses: number;
  created_at: Date;
}

export function createPostgresPromoStore(sql: Sql): PromoAdminStore {
  return {
    async listPromos(tenantId) {
      const rows = await sql<Row[]>`
        select p.id, p.code, p.kind, p.value, p.min_subtotal_cents, p.starts_at, p.ends_at, p.max_uses,
               p.active, p.created_at,
               (select count(*)::int from public.promo_redemptions r where r.promo_code_id = p.id) as uses
        from public.promo_codes p where p.tenant_id = ${tenantId}
        order by p.active desc, p.created_at desc`;
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        kind: r.kind,
        value: r.value,
        minSubtotalCents: r.min_subtotal_cents,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        maxUses: r.max_uses,
        active: r.active,
        uses: r.uses,
        createdAt: r.created_at.toISOString(),
      }));
    },

    async createPromo(tenantId, p) {
      const [row] = await sql<{ id: string }[]>`
        insert into public.promo_codes (tenant_id, code, kind, value, min_subtotal_cents, starts_at, ends_at,
          max_uses, active)
        values (${tenantId}, ${p.code}, ${p.kind}, ${p.value}, ${p.minSubtotalCents}, ${p.startsAt}, ${p.endsAt},
          ${p.maxUses}, ${p.active})
        on conflict (tenant_id, code) do nothing
        returning id`;
      return row ? { id: row.id } : 'conflict';
    },

    async setPromoActive(tenantId, promoId, active) {
      const r = await sql`update public.promo_codes set active = ${active}
                          where tenant_id = ${tenantId} and id = ${promoId}`;
      return r.count === 1;
    },
  };
}
