import type { Sql } from './client';

/**
 * Données locales de la fidélité YouFID (lot 21, ADR 0026) : lien usr_id → QR code, registre des
 * opérations (exactement une fois) et réglages du programme. Même contrat que `YoufidStore` de
 * `@splash360/api-loyalty` (types repris ici : ce paquet ne dépend pas du fournisseur).
 */
export interface YoufidLinkRecord {
  readonly usrId: string;
  readonly qrCode: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birthDate: string | null;
  readonly createdAt: string;
}

export type LoyaltyOperationKindRecord = 'earn' | 'redeem' | 'welcome' | 'bonus' | 'adjust';
export type LoyaltyOperationStatusRecord = 'pending' | 'done' | 'failed' | 'uncertain' | 'resolved';

export interface LoyaltyOperationRecord {
  readonly id: string;
  readonly key: string;
  readonly kind: LoyaltyOperationKindRecord;
  readonly memberId: string;
  readonly orderId: string | null;
  readonly points: number;
  readonly label: string;
  readonly status: LoyaltyOperationStatusRecord;
  readonly error: string | null;
  readonly responsePoints: number | null;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoyaltyProgramSettingsRecord {
  readonly pointsPerEuro: number;
  readonly welcomePoints: number;
}

export interface YoufidPostgresStore {
  saveLink(
    tenantId: string,
    link: { readonly usrId: string; readonly qrCode: string; readonly phone: string | null },
  ): Promise<YoufidLinkRecord>;
  getLink(tenantId: string, usrId: string): Promise<YoufidLinkRecord | null>;
  findLinkByPhone(tenantId: string, phone: string): Promise<YoufidLinkRecord | null>;
  listLinks(tenantId: string, limit: number): Promise<YoufidLinkRecord[]>;
  updateLinkProfile(
    tenantId: string,
    usrId: string,
    input: { readonly email?: string | null; readonly birthDate?: string | null },
  ): Promise<void>;
  deleteLink(tenantId: string, usrId: string): Promise<boolean>;
  claimOperation(
    tenantId: string,
    op: {
      readonly key: string;
      readonly kind: LoyaltyOperationKindRecord;
      readonly memberId: string;
      readonly orderId: string | null;
      readonly points: number;
      readonly label: string;
    },
  ): Promise<{ readonly claimed: boolean; readonly operation: LoyaltyOperationRecord }>;
  finishOperation(
    tenantId: string,
    key: string,
    outcome: {
      readonly status: 'done' | 'failed' | 'uncertain';
      readonly responsePoints?: number | null;
      readonly error?: string | null;
    },
  ): Promise<void>;
  markStale(tenantId: string, key: string, before: Date): Promise<boolean>;
  memberOperations(
    tenantId: string,
    memberId: string,
    limit: number,
  ): Promise<LoyaltyOperationRecord[]>;
  operationsToReview(tenantId: string, limit: number): Promise<LoyaltyOperationRecord[]>;
  resolveOperation(tenantId: string, id: string): Promise<boolean>;
  getProgramSettings(tenantId: string): Promise<LoyaltyProgramSettingsRecord>;
  saveProgramSettings(tenantId: string, settings: LoyaltyProgramSettingsRecord): Promise<void>;
}

interface LinkRow {
  usr_id: string;
  qr_code: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  created_at: Date;
}

interface OpRow {
  id: string;
  op_key: string;
  kind: LoyaltyOperationKindRecord;
  member_id: string;
  order_id: string | null;
  points: number;
  label: string;
  status: LoyaltyOperationStatusRecord;
  error: string | null;
  response_points: number | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toLink = (r: LinkRow): YoufidLinkRecord => ({
  usrId: r.usr_id,
  qrCode: r.qr_code,
  phone: r.phone,
  email: r.email,
  birthDate: r.birth_date,
  createdAt: r.created_at.toISOString(),
});

const toOp = (r: OpRow): LoyaltyOperationRecord => ({
  id: r.id,
  key: r.op_key,
  kind: r.kind,
  memberId: r.member_id,
  orderId: r.order_id,
  points: r.points,
  label: r.label,
  status: r.status,
  error: r.error,
  responsePoints: r.response_points,
  attempts: r.attempts,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export function createPostgresYoufidStore(sql: Sql): YoufidPostgresStore {
  const linkCols = sql`usr_id, qr_code, phone, email, birth_date::text as birth_date, created_at`;
  const opCols = sql`id, op_key, kind, member_id, order_id, points, label, status, error,
                     response_points, attempts, created_at, updated_at`;
  return {
    async saveLink(tenantId, link) {
      const [row] = await sql<LinkRow[]>`
        insert into public.loyalty_members_youfid (tenant_id, usr_id, qr_code, phone)
        values (${tenantId}, ${link.usrId}, ${link.qrCode}, ${link.phone})
        on conflict (tenant_id, usr_id) do update set
          qr_code = excluded.qr_code,
          phone = coalesce(excluded.phone, public.loyalty_members_youfid.phone),
          updated_at = now()
        returning ${linkCols}`;
      if (!row) throw new Error('Lien YouFID non enregistré');
      return toLink(row);
    },
    async getLink(tenantId, usrId) {
      const [row] = await sql<LinkRow[]>`
        select ${linkCols} from public.loyalty_members_youfid
        where tenant_id = ${tenantId} and usr_id = ${usrId}`;
      return row ? toLink(row) : null;
    },
    async findLinkByPhone(tenantId, phone) {
      const [row] = await sql<LinkRow[]>`
        select ${linkCols} from public.loyalty_members_youfid
        where tenant_id = ${tenantId} and phone = ${phone}
        order by updated_at desc limit 1`;
      return row ? toLink(row) : null;
    },
    async listLinks(tenantId, limit) {
      const rows = await sql<LinkRow[]>`
        select ${linkCols} from public.loyalty_members_youfid
        where tenant_id = ${tenantId} order by created_at desc, usr_id desc limit ${limit}`;
      return rows.map(toLink);
    },
    async updateLinkProfile(tenantId, usrId, input) {
      if (input.email === undefined && input.birthDate === undefined) return;
      await sql`
        update public.loyalty_members_youfid set
          email = case when ${input.email !== undefined} then ${input.email ?? null} else email end,
          birth_date = case when ${input.birthDate !== undefined}
                       then ${input.birthDate ?? null}::date else birth_date end,
          updated_at = now()
        where tenant_id = ${tenantId} and usr_id = ${usrId}`;
    },
    async deleteLink(tenantId, usrId) {
      const rows = await sql`
        delete from public.loyalty_members_youfid
        where tenant_id = ${tenantId} and usr_id = ${usrId} returning usr_id`;
      return rows.length > 0;
    },

    async claimOperation(tenantId, op) {
      // Insertion conditionnelle : une seule réservation gagne ; une opération refusée est reprise.
      const [claimed] = await sql<OpRow[]>`
        insert into public.loyalty_operations
          (tenant_id, op_key, kind, member_id, order_id, points, label)
        values (${tenantId}, ${op.key}, ${op.kind}, ${op.memberId}, ${op.orderId},
                ${op.points}, ${op.label})
        on conflict (tenant_id, op_key) do update set
          status = 'pending', error = null, attempts = public.loyalty_operations.attempts + 1,
          updated_at = now()
        where public.loyalty_operations.status = 'failed'
        returning ${opCols}`;
      if (claimed) return { claimed: true, operation: toOp(claimed) };
      const [existing] = await sql<OpRow[]>`
        select ${opCols} from public.loyalty_operations
        where tenant_id = ${tenantId} and op_key = ${op.key}`;
      if (!existing) throw new Error('Opération de fidélité introuvable');
      return { claimed: false, operation: toOp(existing) };
    },
    async finishOperation(tenantId, key, outcome) {
      await sql`
        update public.loyalty_operations set
          status = ${outcome.status},
          response_points = ${outcome.responsePoints ?? null},
          error = ${outcome.error?.slice(0, 200) ?? null},
          updated_at = now()
        where tenant_id = ${tenantId} and op_key = ${key} and status = 'pending'`;
    },
    async markStale(tenantId, key, before) {
      const rows = await sql`
        update public.loyalty_operations set status = 'uncertain', error = 'interrupted',
          updated_at = now()
        where tenant_id = ${tenantId} and op_key = ${key} and status = 'pending'
          and updated_at < ${before}
        returning id`;
      return rows.length > 0;
    },
    async memberOperations(tenantId, memberId, limit) {
      const rows = await sql<OpRow[]>`
        select ${opCols} from public.loyalty_operations
        where tenant_id = ${tenantId} and member_id = ${memberId}
        order by created_at desc, id desc limit ${limit}`;
      return rows.map(toOp);
    },
    async operationsToReview(tenantId, limit) {
      const rows = await sql<OpRow[]>`
        select ${opCols} from public.loyalty_operations
        where tenant_id = ${tenantId} and status in ('failed', 'uncertain')
        order by updated_at desc limit ${limit}`;
      return rows.map(toOp);
    },
    async resolveOperation(tenantId, id) {
      if (!UUID.test(id)) return false;
      const rows = await sql`
        update public.loyalty_operations set status = 'resolved', updated_at = now()
        where tenant_id = ${tenantId} and id = ${id} and status in ('failed', 'uncertain')
        returning id`;
      return rows.length > 0;
    },

    async getProgramSettings(tenantId) {
      const [row] = await sql<{ points_per_euro: number; welcome_points: number }[]>`
        select points_per_euro, welcome_points from public.loyalty_program_settings
        where tenant_id = ${tenantId}`;
      // Défauts du propriétaire : 1 point par euro (26/11), 100 de bienvenue ; identiques à la table.
      return {
        pointsPerEuro: row?.points_per_euro ?? 1,
        welcomePoints: row?.welcome_points ?? 100,
      };
    },
    async saveProgramSettings(tenantId, s) {
      await sql`
        insert into public.loyalty_program_settings (tenant_id, points_per_euro, welcome_points)
        values (${tenantId}, ${s.pointsPerEuro}, ${s.welcomePoints})
        on conflict (tenant_id) do update set
          points_per_euro = excluded.points_per_euro,
          welcome_points = excluded.welcome_points,
          updated_at = now()`;
    },
  };
}
