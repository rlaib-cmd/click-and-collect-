import type { Sql } from './client';

/**
 * Copie minimale de l'export des ventes Splash360 (lot 20, ADR 0025), pour vérifier un ticket
 * « Ambassadeur » photographié : ni client, ni lignes, ni règlements.
 */
export interface PosSaleRecord {
  /** Identifiant de la vente (UUID, en minuscules), imprimé sur le ticket. */
  readonly ticketId: string;
  /** Identifiant Splash360 du restaurant (comme `restaurants.splash360_id`). */
  readonly restaurantId: string;
  /** Journée comptable (AAAA-MM-JJ). */
  readonly jourComptable: string;
  readonly status: 'confirmed' | 'deleted';
  readonly totalCents: number;
}

/** Avancement de la lecture de l'export pour une enseigne et une journée. */
export interface PosSalesCursor {
  /** Prochaine page à lire (0 = début : l'export Splash360 numérote à partir de 0). */
  readonly nextPage: number;
  /** La lecture en cours a commencé après la fin de la journée (heure de Paris). */
  readonly passAfterDay: boolean;
  /** Journée entièrement lue après sa fin : une vente absente n'existe pas. */
  readonly complete: boolean;
}

/** Première page de l'export des ventes Splash360. */
/** Première page de l'export des ventes : Splash360 numérote à partir de 0 (constaté le 25/11). */
export const FIRST_SALES_PAGE = 0;

export const EMPTY_SALES_CURSOR: PosSalesCursor = {
  nextPage: FIRST_SALES_PAGE,
  passAfterDay: false,
  complete: false,
};

export interface PosSalesStore {
  /** Enregistre (ou met à jour : statut, total) des ventes d'une enseigne. */
  saveSales(tenantId: string, sales: readonly PosSaleRecord[], at: Date): Promise<void>;
  /** Vente de l'enseigne portant cet identifiant (sans casse), quelle que soit sa journée. */
  findSale(tenantId: string, ticketId: string): Promise<PosSaleRecord | null>;
  getCursor(tenantId: string, jour: string): Promise<PosSalesCursor>;
  saveCursor(tenantId: string, jour: string, cursor: PosSalesCursor, at: Date): Promise<void>;
}

interface SaleRow {
  ticket_id: string;
  splash360_restaurant_id: string;
  jour_comptable: string;
  status: 'confirmed' | 'deleted';
  total_cents: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createPostgresPosSalesStore(sql: Sql): PosSalesStore {
  return {
    async saveSales(tenantId, sales, at) {
      if (sales.length === 0) return;
      const rows = sales.map((s) => ({
        tenant_id: tenantId,
        ticket_id: s.ticketId.toLowerCase(),
        splash360_restaurant_id: s.restaurantId,
        jour_comptable: s.jourComptable,
        status: s.status,
        total_cents: s.totalCents,
        synced_at: at,
      }));
      await sql`insert into public.pos_sales ${sql(rows)}
        on conflict (tenant_id, ticket_id) do update set
          splash360_restaurant_id = excluded.splash360_restaurant_id,
          jour_comptable = excluded.jour_comptable,
          status = excluded.status, total_cents = excluded.total_cents,
          synced_at = excluded.synced_at`;
    },

    async findSale(tenantId, ticketId) {
      const rows = await sql<SaleRow[]>`select ticket_id, splash360_restaurant_id,
          jour_comptable::text, status, total_cents
        from public.pos_sales
        where tenant_id = ${tenantId} and ticket_id = ${ticketId.toLowerCase()}`;
      const r = rows[0];
      return r
        ? {
            ticketId: r.ticket_id,
            restaurantId: r.splash360_restaurant_id,
            jourComptable: r.jour_comptable,
            status: r.status,
            totalCents: r.total_cents,
          }
        : null;
    },

    async getCursor(tenantId, jour) {
      if (!DATE.test(jour)) return EMPTY_SALES_CURSOR;
      const rows = await sql<
        { next_page: number; pass_after_day: boolean; complete: boolean }[]
      >`select next_page, pass_after_day, complete from public.pos_sales_sync
        where tenant_id = ${tenantId} and jour = ${jour}`;
      const r = rows[0];
      return r
        ? { nextPage: r.next_page, passAfterDay: r.pass_after_day, complete: r.complete }
        : EMPTY_SALES_CURSOR;
    },

    async saveCursor(tenantId, jour, cursor, at) {
      await sql`insert into public.pos_sales_sync (tenant_id, jour, next_page, pass_after_day,
          complete, updated_at)
        values (${tenantId}, ${jour}, ${cursor.nextPage}, ${cursor.passAfterDay},
          ${cursor.complete}, ${at})
        on conflict (tenant_id, jour) do update set next_page = excluded.next_page,
          pass_after_day = excluded.pass_after_day, complete = excluded.complete,
          updated_at = excluded.updated_at`;
    },
  };
}

/** Version en mémoire (tests, serveur de démonstration). */
export function createMemoryPosSalesStore(): PosSalesStore & {
  readonly sales: Map<string, PosSaleRecord & { readonly tenantId: string }>;
  readonly cursors: Map<string, PosSalesCursor>;
} {
  const sales = new Map<string, PosSaleRecord & { readonly tenantId: string }>();
  const cursors = new Map<string, PosSalesCursor>();
  return {
    sales,
    cursors,
    saveSales(tenantId, list) {
      for (const s of list) {
        const ticketId = s.ticketId.toLowerCase();
        sales.set(`${tenantId}/${ticketId}`, { ...s, ticketId, tenantId });
      }
      return Promise.resolve();
    },
    findSale(tenantId, ticketId) {
      const found = sales.get(`${tenantId}/${ticketId.toLowerCase()}`);
      if (!found) return Promise.resolve(null);
      const { tenantId: _t, ...sale } = found;
      return Promise.resolve(sale);
    },
    getCursor: (tenantId, jour) =>
      Promise.resolve(cursors.get(`${tenantId}/${jour}`) ?? EMPTY_SALES_CURSOR),
    saveCursor(tenantId, jour, cursor) {
      cursors.set(`${tenantId}/${jour}`, cursor);
      return Promise.resolve();
    },
  };
}
