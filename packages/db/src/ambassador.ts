import { randomUUID } from 'node:crypto';
import type { Sql } from './client';

/** Ambassadeur (lot 15, ADR 0019) : réglages de l'enseigne et participations des membres. */
export interface AmbassadorSettings {
  readonly enabled: boolean;
  /** Compte Instagram à taguer, sans « @ ». */
  readonly instagramHandle: string | null;
  readonly bonusPoints: number;
}

export type AmbassadorStatus = 'pending' | 'confirmed' | 'rejected';

export interface AmbassadorEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly memberId: string;
  readonly status: AmbassadorStatus;
  readonly ticketRef: string;
  readonly instagramHandle: string;
  readonly bonusPoints: number;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

export interface NewAmbassadorEntry {
  readonly tenantId: string;
  readonly memberId: string;
  readonly ticketRef: string;
  readonly instagramHandle: string;
  readonly bonusPoints: number;
}

export type CreateEntryResult =
  | { readonly ok: true; readonly entry: AmbassadorEntry }
  | { readonly ok: false; readonly error: 'ticket_already_used' };

export const DEFAULT_AMBASSADOR_SETTINGS: AmbassadorSettings = {
  enabled: false,
  instagramHandle: null,
  bonusPoints: 50,
};

export interface AmbassadorStore {
  getSettings(tenantId: string): Promise<AmbassadorSettings>;
  saveSettings(tenantId: string, settings: AmbassadorSettings): Promise<void>;
  /** Une participation par ticket et par enseigne. */
  createEntry(entry: NewAmbassadorEntry): Promise<CreateEntryResult>;
  listEntries(tenantId: string, limit: number): Promise<readonly AmbassadorEntry[]>;
  memberEntries(tenantId: string, memberId: string): Promise<readonly AmbassadorEntry[]>;
  /**
   * Décide une participation encore « pending » ; renvoie la participation décidée, ou null si
   * elle n'existe pas ou a déjà été décidée (un seul passage, donc un seul crédit de points).
   */
  decide(
    tenantId: string,
    entryId: string,
    status: Exclude<AmbassadorStatus, 'pending'>,
    at: Date,
  ): Promise<AmbassadorEntry | null>;
}

interface Row {
  id: string;
  tenant_id: string;
  member_id: string;
  status: AmbassadorStatus;
  ticket_ref: string;
  instagram_handle: string;
  bonus_points: number;
  created_at: Date;
  decided_at: Date | null;
}

const toEntry = (r: Row): AmbassadorEntry => ({
  id: r.id,
  tenantId: r.tenant_id,
  memberId: r.member_id,
  status: r.status,
  ticketRef: r.ticket_ref,
  instagramHandle: r.instagram_handle,
  bonusPoints: r.bonus_points,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresAmbassadorStore(sql: Sql): AmbassadorStore {
  return {
    async getSettings(tenantId) {
      const rows = await sql<
        { enabled: boolean; instagram_handle: string | null; bonus_points: number }[]
      >`select enabled, instagram_handle, bonus_points from public.ambassador_settings
        where tenant_id = ${tenantId}`;
      const r = rows[0];
      return r
        ? { enabled: r.enabled, instagramHandle: r.instagram_handle, bonusPoints: r.bonus_points }
        : DEFAULT_AMBASSADOR_SETTINGS;
    },

    async saveSettings(tenantId, s) {
      await sql`insert into public.ambassador_settings (tenant_id, enabled, instagram_handle, bonus_points, updated_at)
                values (${tenantId}, ${s.enabled}, ${s.instagramHandle}, ${s.bonusPoints}, now())
                on conflict (tenant_id) do update set enabled = excluded.enabled,
                  instagram_handle = excluded.instagram_handle, bonus_points = excluded.bonus_points,
                  updated_at = now()`;
    },

    async createEntry(e) {
      const rows = await sql<Row[]>`
        insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, instagram_handle, bonus_points)
        values (${e.tenantId}, ${e.memberId}, ${e.ticketRef}, ${e.instagramHandle}, ${e.bonusPoints})
        on conflict (tenant_id, ticket_ref) do nothing
        returning *`;
      const r = rows[0];
      return r ? { ok: true, entry: toEntry(r) } : { ok: false, error: 'ticket_already_used' };
    },

    async listEntries(tenantId, limit) {
      const rows = await sql<Row[]>`select * from public.ambassador_entries
        where tenant_id = ${tenantId} order by created_at desc limit ${limit}`;
      return rows.map(toEntry);
    },

    async memberEntries(tenantId, memberId) {
      const rows = await sql<Row[]>`select * from public.ambassador_entries
        where tenant_id = ${tenantId} and member_id = ${memberId} order by created_at desc limit 50`;
      return rows.map(toEntry);
    },

    async decide(tenantId, entryId, status, at) {
      if (!UUID.test(entryId)) return null;
      const rows = await sql<Row[]>`update public.ambassador_entries
        set status = ${status}, decided_at = ${at}
        where tenant_id = ${tenantId} and id = ${entryId} and status = 'pending'
        returning *`;
      return rows[0] ? toEntry(rows[0]) : null;
    },
  };
}

/** Version en mémoire (tests, serveur de démonstration). */
export function createMemoryAmbassadorStore(
  settings: Readonly<Record<string, AmbassadorSettings>> = {},
): AmbassadorStore & { readonly entries: AmbassadorEntry[] } {
  const config = new Map(Object.entries(settings));
  const entries: AmbassadorEntry[] = [];
  const byNewest = (list: AmbassadorEntry[]) =>
    [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    entries,
    getSettings: (tenantId) => Promise.resolve(config.get(tenantId) ?? DEFAULT_AMBASSADOR_SETTINGS),
    saveSettings(tenantId, s) {
      config.set(tenantId, s);
      return Promise.resolve();
    },
    createEntry(e) {
      if (entries.some((x) => x.tenantId === e.tenantId && x.ticketRef === e.ticketRef))
        return Promise.resolve({ ok: false, error: 'ticket_already_used' } as const);
      const entry: AmbassadorEntry = {
        ...e,
        id: randomUUID(),
        status: 'pending',
        createdAt: new Date(),
        decidedAt: null,
      };
      entries.push(entry);
      return Promise.resolve({ ok: true, entry } as const);
    },
    listEntries: (tenantId, limit) =>
      Promise.resolve(byNewest(entries.filter((x) => x.tenantId === tenantId)).slice(0, limit)),
    memberEntries: (tenantId, memberId) =>
      Promise.resolve(
        byNewest(entries.filter((x) => x.tenantId === tenantId && x.memberId === memberId)),
      ),
    decide(tenantId, entryId, status, at) {
      const i = entries.findIndex(
        (x) => x.tenantId === tenantId && x.id === entryId && x.status === 'pending',
      );
      const current = entries[i];
      if (!current) return Promise.resolve(null);
      const decided: AmbassadorEntry = { ...current, status, decidedAt: at };
      entries[i] = decided;
      return Promise.resolve(decided);
    },
  };
}
