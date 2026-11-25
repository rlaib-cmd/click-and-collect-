import { randomUUID } from 'node:crypto';
import type { Queryable, Sql } from './client';

/**
 * Ambassadeur (lots 15 et 17, ADR 0019 et 0022) : réglages de l'enseigne, compte Instagram
 * mémorisé du membre, participations (une par achat) et leur historique complet.
 */
export interface AmbassadorSettings {
  readonly enabled: boolean;
  /** Compte Instagram à taguer, sans « @ ». */
  readonly instagramHandle: string | null;
  readonly bonusPoints: number;
  /** Contrôle « story toujours en ligne ? » : heures après la mention. */
  readonly checkAfterHours: number;
  /** Crédit des points : heures après la mention. */
  readonly creditAfterHours: number;
  /** Catégorie de l'enseigne (burgers, pizza…) : contexte de l'analyse de la photo. */
  readonly photoCategory: string;
}

export type AmbassadorStatus = 'pending' | 'confirmed' | 'rejected';
export type PhotoVerdict = 'accepted' | 'rejected' | 'doubtful';
export type StoryCheckResult = 'online' | 'removed';

export interface AmbassadorEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly memberId: string;
  readonly status: AmbassadorStatus;
  readonly ticketRef: string;
  /** Contenu brut du QR scanné ; null si le numéro a été saisi. */
  readonly ticketQr: string | null;
  readonly instagramHandle: string;
  readonly bonusPoints: number;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly mentionReceivedAt: Date | null;
  readonly mentionBy: string | null;
  readonly checkDueAt: Date | null;
  readonly checkedAt: Date | null;
  readonly checkResult: StoryCheckResult | null;
  readonly creditDueAt: Date | null;
  readonly photoVerdict: PhotoVerdict | null;
  readonly photoReason: string | null;
  readonly needsReview: boolean;
}

export interface NewAmbassadorEntry {
  readonly tenantId: string;
  readonly memberId: string;
  readonly ticketRef: string;
  readonly ticketQr?: string | null;
  readonly instagramHandle: string;
  readonly bonusPoints: number;
  readonly photoVerdict?: PhotoVerdict | null;
  readonly photoReason?: string | null;
  readonly needsReview?: boolean;
}

export type AmbassadorEventType =
  | 'created'
  | 'photo_checked'
  | 'mention_received'
  | 'story_checked'
  | 'credited'
  | 'credit_failed'
  | 'rejected';

export type AmbassadorEventDetail = Readonly<Record<string, string | number | boolean | null>>;

/** Étape journalisée : « client », « système », « IA » ou l'e-mail du membre de l'équipe. */
export interface AmbassadorEventInput {
  readonly type: AmbassadorEventType;
  readonly actor: string;
  readonly detail?: AmbassadorEventDetail;
}

export interface AmbassadorEvent extends Required<AmbassadorEventInput> {
  readonly entryId: string;
  readonly at: Date;
}

export type CreateEntryResult =
  | { readonly ok: true; readonly entry: AmbassadorEntry }
  | { readonly ok: false; readonly error: 'ticket_already_used' };

/** Participation dont le contrôle ou le crédit est échu (tâche périodique). */
export type DueAmbassadorEntry = AmbassadorEntry & { readonly splash360Id: string };

export const DEFAULT_AMBASSADOR_SETTINGS: AmbassadorSettings = {
  enabled: false,
  instagramHandle: null,
  bonusPoints: 50,
  checkAfterHours: 20,
  creditAfterHours: 24,
  photoCategory: 'restaurant',
};

export interface AmbassadorStore {
  getSettings(tenantId: string): Promise<AmbassadorSettings>;
  saveSettings(tenantId: string, settings: AmbassadorSettings): Promise<void>;
  /** Compte Instagram mémorisé du membre (null s'il ne l'a jamais saisi). */
  getProfile(tenantId: string, memberId: string): Promise<string | null>;
  saveProfile(tenantId: string, memberId: string, instagramHandle: string): Promise<void>;
  /**
   * Une participation par ticket (donc par achat) et par enseigne. Les événements donnés
   * (création, analyse de la photo) sont journalisés dans la même transaction.
   */
  createEntry(
    entry: NewAmbassadorEntry,
    events: readonly AmbassadorEventInput[],
  ): Promise<CreateEntryResult>;
  getEntry(tenantId: string, entryId: string): Promise<AmbassadorEntry | null>;
  listEntries(tenantId: string, limit: number): Promise<readonly AmbassadorEntry[]>;
  memberEntries(tenantId: string, memberId: string): Promise<readonly AmbassadorEntry[]>;
  /** Historique des participations données, dans l'ordre chronologique. */
  events(tenantId: string, entryIds: readonly string[]): Promise<readonly AmbassadorEvent[]>;
  addEvent(tenantId: string, entryId: string, event: AmbassadorEventInput): Promise<void>;
  /**
   * « Mention reçue » : fixe les échéances du contrôle et du crédit. Une seule fois, et seulement
   * tant que la participation est en attente ; null sinon.
   */
  markMention(
    tenantId: string,
    entryId: string,
    mention: {
      readonly at: Date;
      readonly by: string;
      readonly checkDueAt: Date;
      readonly creditDueAt: Date;
    },
  ): Promise<AmbassadorEntry | null>;
  /** Résultat du contrôle de la story ; une seule fois, participation en attente ; null sinon. */
  recordCheck(
    tenantId: string,
    entryId: string,
    check: { readonly at: Date; readonly result: StoryCheckResult; readonly actor: string },
  ): Promise<AmbassadorEntry | null>;
  /**
   * Décide une participation encore « pending » ; renvoie la participation décidée, ou null si
   * elle n'existe pas ou a déjà été décidée (un seul passage, donc un seul crédit de points).
   * L'événement éventuel est journalisé dans la même transaction.
   */
  decide(
    tenantId: string,
    entryId: string,
    status: Exclude<AmbassadorStatus, 'pending'>,
    at: Date,
    event?: AmbassadorEventInput,
  ): Promise<AmbassadorEntry | null>;
  /** Participations en attente dont le contrôle ou le crédit est échu, toutes enseignes. */
  dueEntries(now: Date, limit: number): Promise<readonly DueAmbassadorEntry[]>;
}

interface Row {
  id: string;
  tenant_id: string;
  member_id: string;
  status: AmbassadorStatus;
  ticket_ref: string;
  ticket_qr: string | null;
  instagram_handle: string;
  bonus_points: number;
  created_at: Date;
  decided_at: Date | null;
  mention_received_at: Date | null;
  mention_by: string | null;
  check_due_at: Date | null;
  checked_at: Date | null;
  check_result: StoryCheckResult | null;
  credit_due_at: Date | null;
  photo_verdict: PhotoVerdict | null;
  photo_reason: string | null;
  needs_review: boolean;
}

const toEntry = (r: Row): AmbassadorEntry => ({
  id: r.id,
  tenantId: r.tenant_id,
  memberId: r.member_id,
  status: r.status,
  ticketRef: r.ticket_ref,
  ticketQr: r.ticket_qr,
  instagramHandle: r.instagram_handle,
  bonusPoints: r.bonus_points,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  mentionReceivedAt: r.mention_received_at,
  mentionBy: r.mention_by,
  checkDueAt: r.check_due_at,
  checkedAt: r.checked_at,
  checkResult: r.check_result,
  creditDueAt: r.credit_due_at,
  photoVerdict: r.photo_verdict,
  photoReason: r.photo_reason,
  needsReview: r.needs_review,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SettingsRow {
  enabled: boolean;
  instagram_handle: string | null;
  bonus_points: number;
  check_after_hours: number;
  credit_after_hours: number;
  photo_category: string;
}

async function insertEvent(
  tx: Queryable,
  tenantId: string,
  entryId: string,
  e: AmbassadorEventInput,
  at: Date,
) {
  await tx`insert into public.ambassador_events (tenant_id, entry_id, type, actor, detail, at)
           values (${tenantId}, ${entryId}, ${e.type}, ${e.actor}, ${tx.json(e.detail ?? {})}, ${at})`;
}

export function createPostgresAmbassadorStore(sql: Sql): AmbassadorStore {
  return {
    async getSettings(tenantId) {
      const rows = await sql<SettingsRow[]>`select enabled, instagram_handle, bonus_points,
          check_after_hours, credit_after_hours, photo_category
        from public.ambassador_settings where tenant_id = ${tenantId}`;
      const r = rows[0];
      return r
        ? {
            enabled: r.enabled,
            instagramHandle: r.instagram_handle,
            bonusPoints: r.bonus_points,
            checkAfterHours: r.check_after_hours,
            creditAfterHours: r.credit_after_hours,
            photoCategory: r.photo_category,
          }
        : DEFAULT_AMBASSADOR_SETTINGS;
    },

    async saveSettings(tenantId, s) {
      await sql`insert into public.ambassador_settings (tenant_id, enabled, instagram_handle, bonus_points,
                  check_after_hours, credit_after_hours, photo_category, updated_at)
                values (${tenantId}, ${s.enabled}, ${s.instagramHandle}, ${s.bonusPoints},
                  ${s.checkAfterHours}, ${s.creditAfterHours}, ${s.photoCategory}, now())
                on conflict (tenant_id) do update set enabled = excluded.enabled,
                  instagram_handle = excluded.instagram_handle, bonus_points = excluded.bonus_points,
                  check_after_hours = excluded.check_after_hours,
                  credit_after_hours = excluded.credit_after_hours,
                  photo_category = excluded.photo_category, updated_at = now()`;
    },

    async getProfile(tenantId, memberId) {
      const rows = await sql<{ instagram_handle: string }[]>`select instagram_handle
        from public.ambassador_profiles where tenant_id = ${tenantId} and member_id = ${memberId}`;
      return rows[0]?.instagram_handle ?? null;
    },

    async saveProfile(tenantId, memberId, handle) {
      await sql`insert into public.ambassador_profiles (tenant_id, member_id, instagram_handle, updated_at)
                values (${tenantId}, ${memberId}, ${handle}, now())
                on conflict (tenant_id, member_id) do update
                  set instagram_handle = excluded.instagram_handle, updated_at = now()`;
    },

    async createEntry(e, events) {
      return sql.begin(async (tx) => {
        const rows = await tx<Row[]>`
          insert into public.ambassador_entries (tenant_id, member_id, ticket_ref, ticket_qr,
            instagram_handle, bonus_points, photo_verdict, photo_reason, needs_review)
          values (${e.tenantId}, ${e.memberId}, ${e.ticketRef}, ${e.ticketQr ?? null},
            ${e.instagramHandle}, ${e.bonusPoints}, ${e.photoVerdict ?? null},
            ${e.photoReason ?? null}, ${e.needsReview ?? false})
          on conflict (tenant_id, ticket_ref) do nothing
          returning *`;
        const r = rows[0];
        if (!r) return { ok: false, error: 'ticket_already_used' } as const;
        for (const ev of events) await insertEvent(tx, e.tenantId, r.id, ev, r.created_at);
        return { ok: true, entry: toEntry(r) } as const;
      });
    },

    async getEntry(tenantId, entryId) {
      if (!UUID.test(entryId)) return null;
      const rows = await sql<Row[]>`select * from public.ambassador_entries
        where tenant_id = ${tenantId} and id = ${entryId}`;
      return rows[0] ? toEntry(rows[0]) : null;
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

    async events(tenantId, entryIds) {
      const ids = entryIds.filter((id) => UUID.test(id));
      if (ids.length === 0) return [];
      const rows = await sql<
        { entry_id: string; type: AmbassadorEventType; actor: string; detail: unknown; at: Date }[]
      >`select entry_id, type, actor, detail, at from public.ambassador_events
        where tenant_id = ${tenantId} and entry_id in ${sql(ids)} order by at, id`;
      return rows.map((r) => ({
        entryId: r.entry_id,
        type: r.type,
        actor: r.actor,
        detail: toDetail(r.detail),
        at: r.at,
      }));
    },

    async addEvent(tenantId, entryId, event) {
      await insertEvent(sql, tenantId, entryId, event, new Date());
    },

    async markMention(tenantId, entryId, m) {
      if (!UUID.test(entryId)) return null;
      return sql.begin(async (tx) => {
        const rows = await tx<Row[]>`update public.ambassador_entries
          set mention_received_at = ${m.at}, mention_by = ${m.by},
            check_due_at = ${m.checkDueAt}, credit_due_at = ${m.creditDueAt}
          where tenant_id = ${tenantId} and id = ${entryId} and status = 'pending'
            and mention_received_at is null
          returning *`;
        const r = rows[0];
        if (!r) return null;
        await insertEvent(
          tx,
          tenantId,
          entryId,
          {
            type: 'mention_received',
            actor: m.by,
            detail: {
              checkDueAt: m.checkDueAt.toISOString(),
              creditDueAt: m.creditDueAt.toISOString(),
            },
          },
          m.at,
        );
        return toEntry(r);
      });
    },

    async recordCheck(tenantId, entryId, check) {
      if (!UUID.test(entryId)) return null;
      return sql.begin(async (tx) => {
        const rows = await tx<Row[]>`update public.ambassador_entries
          set checked_at = ${check.at}, check_result = ${check.result}
          where tenant_id = ${tenantId} and id = ${entryId} and status = 'pending'
            and mention_received_at is not null and checked_at is null
          returning *`;
        const r = rows[0];
        if (!r) return null;
        await insertEvent(
          tx,
          tenantId,
          entryId,
          { type: 'story_checked', actor: check.actor, detail: { result: check.result } },
          check.at,
        );
        return toEntry(r);
      });
    },

    async decide(tenantId, entryId, status, at, event) {
      if (!UUID.test(entryId)) return null;
      return sql.begin(async (tx) => {
        const rows = await tx<Row[]>`update public.ambassador_entries
          set status = ${status}, decided_at = ${at}
          where tenant_id = ${tenantId} and id = ${entryId} and status = 'pending'
          returning *`;
        const r = rows[0];
        if (!r) return null;
        if (event) await insertEvent(tx, tenantId, entryId, event, at);
        return toEntry(r);
      });
    },

    async dueEntries(now, limit) {
      const rows = await sql<(Row & { splash360_id: string })[]>`
        select e.*, t.splash360_id from public.ambassador_entries e
        join public.tenants t on t.id = e.tenant_id
        where e.status = 'pending' and e.mention_received_at is not null
          and ((e.checked_at is null and e.check_due_at <= ${now}) or e.credit_due_at <= ${now})
        order by e.check_due_at limit ${limit}`;
      return rows.map((r) => ({ ...toEntry(r), splash360Id: r.splash360_id }));
    },
  };
}

function toDetail(value: unknown): AmbassadorEventDetail {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      out[k] = v;
  }
  return out;
}

/** Réglages partiels acceptés par la version en mémoire (les délais prennent leur défaut). */
export type AmbassadorSettingsInput = Pick<
  AmbassadorSettings,
  'enabled' | 'instagramHandle' | 'bonusPoints'
> &
  Partial<AmbassadorSettings>;

/** Version en mémoire (tests, serveur de démonstration). */
export function createMemoryAmbassadorStore(
  settings: Readonly<Record<string, AmbassadorSettingsInput>> = {},
  options: { readonly splash360Ids?: Readonly<Record<string, string>> } = {},
): AmbassadorStore & {
  readonly entries: AmbassadorEntry[];
  readonly history: AmbassadorEvent[];
} {
  const config = new Map(
    Object.entries(settings).map(([k, v]) => [k, { ...DEFAULT_AMBASSADOR_SETTINGS, ...v }]),
  );
  const entries: AmbassadorEntry[] = [];
  const history: (AmbassadorEvent & { tenantId: string })[] = [];
  const profiles = new Map<string, string>();
  const byNewest = (list: AmbassadorEntry[]) =>
    [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const log = (tenantId: string, entryId: string, e: AmbassadorEventInput, at: Date) =>
    history.push({ tenantId, entryId, type: e.type, actor: e.actor, detail: e.detail ?? {}, at });
  /** Met à jour une participation si `when` l'autorise (équivalent du `update … where`). */
  const update = (
    tenantId: string,
    entryId: string,
    when: (e: AmbassadorEntry) => boolean,
    patch: Partial<AmbassadorEntry>,
  ): AmbassadorEntry | null => {
    const i = entries.findIndex((x) => x.tenantId === tenantId && x.id === entryId);
    const current = entries[i];
    if (!current || !when(current)) return null;
    const next: AmbassadorEntry = { ...current, ...patch };
    entries[i] = next;
    return next;
  };
  return {
    entries,
    history,
    getSettings: (tenantId) => Promise.resolve(config.get(tenantId) ?? DEFAULT_AMBASSADOR_SETTINGS),
    saveSettings(tenantId, s) {
      config.set(tenantId, s);
      return Promise.resolve();
    },
    getProfile: (tenantId, memberId) =>
      Promise.resolve(profiles.get(`${tenantId}/${memberId}`) ?? null),
    saveProfile(tenantId, memberId, handle) {
      profiles.set(`${tenantId}/${memberId}`, handle);
      return Promise.resolve();
    },
    createEntry(e, events) {
      if (entries.some((x) => x.tenantId === e.tenantId && x.ticketRef === e.ticketRef))
        return Promise.resolve({ ok: false, error: 'ticket_already_used' } as const);
      const entry: AmbassadorEntry = {
        tenantId: e.tenantId,
        memberId: e.memberId,
        ticketRef: e.ticketRef,
        instagramHandle: e.instagramHandle,
        bonusPoints: e.bonusPoints,
        ticketQr: e.ticketQr ?? null,
        id: randomUUID(),
        status: 'pending',
        createdAt: new Date(),
        decidedAt: null,
        mentionReceivedAt: null,
        mentionBy: null,
        checkDueAt: null,
        checkedAt: null,
        checkResult: null,
        creditDueAt: null,
        photoVerdict: e.photoVerdict ?? null,
        photoReason: e.photoReason ?? null,
        needsReview: e.needsReview ?? false,
      };
      entries.push(entry);
      for (const ev of events) log(e.tenantId, entry.id, ev, entry.createdAt);
      return Promise.resolve({ ok: true, entry } as const);
    },
    getEntry: (tenantId, entryId) =>
      Promise.resolve(entries.find((x) => x.tenantId === tenantId && x.id === entryId) ?? null),
    listEntries: (tenantId, limit) =>
      Promise.resolve(byNewest(entries.filter((x) => x.tenantId === tenantId)).slice(0, limit)),
    memberEntries: (tenantId, memberId) =>
      Promise.resolve(
        byNewest(entries.filter((x) => x.tenantId === tenantId && x.memberId === memberId)),
      ),
    // Ordre d’écriture (la base trie par date puis par identifiant, soit le même ordre).
    events: (tenantId, entryIds) =>
      Promise.resolve(
        history
          .filter((h) => h.tenantId === tenantId && entryIds.includes(h.entryId))
          .map(({ tenantId: _t, ...h }) => h),
      ),
    addEvent(tenantId, entryId, event) {
      log(tenantId, entryId, event, new Date());
      return Promise.resolve();
    },
    markMention(tenantId, entryId, m) {
      const next = update(
        tenantId,
        entryId,
        (e) => e.status === 'pending' && e.mentionReceivedAt === null,
        {
          mentionReceivedAt: m.at,
          mentionBy: m.by,
          checkDueAt: m.checkDueAt,
          creditDueAt: m.creditDueAt,
        },
      );
      if (next)
        log(
          tenantId,
          entryId,
          {
            type: 'mention_received',
            actor: m.by,
            detail: {
              checkDueAt: m.checkDueAt.toISOString(),
              creditDueAt: m.creditDueAt.toISOString(),
            },
          },
          m.at,
        );
      return Promise.resolve(next);
    },
    recordCheck(tenantId, entryId, check) {
      const next = update(
        tenantId,
        entryId,
        (e) => e.status === 'pending' && e.mentionReceivedAt !== null && e.checkedAt === null,
        { checkedAt: check.at, checkResult: check.result },
      );
      if (next)
        log(
          tenantId,
          entryId,
          { type: 'story_checked', actor: check.actor, detail: { result: check.result } },
          check.at,
        );
      return Promise.resolve(next);
    },
    decide(tenantId, entryId, status, at, event) {
      const next = update(tenantId, entryId, (e) => e.status === 'pending', {
        status,
        decidedAt: at,
      });
      if (next && event) log(tenantId, entryId, event, at);
      return Promise.resolve(next);
    },
    dueEntries(now, limit) {
      const t = now.getTime();
      return Promise.resolve(
        entries
          .filter(
            (e) =>
              e.status === 'pending' &&
              e.mentionReceivedAt !== null &&
              ((e.checkedAt === null && (e.checkDueAt?.getTime() ?? Infinity) <= t) ||
                (e.creditDueAt?.getTime() ?? Infinity) <= t),
          )
          .sort((a, b) => (a.checkDueAt?.getTime() ?? 0) - (b.checkDueAt?.getTime() ?? 0))
          .slice(0, limit)
          .map((e) => ({ ...e, splash360Id: options.splash360Ids?.[e.tenantId] ?? '' })),
      );
    },
  };
}
