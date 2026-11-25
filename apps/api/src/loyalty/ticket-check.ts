import type { Splash360SalesPage } from '@splash360/api-menu';
import type {
  AmbassadorEntry,
  AmbassadorEventInput,
  AmbassadorStore,
  PosSaleRecord,
  PosSalesCursor,
  PosSalesStore,
  RestaurantStore,
  TicketCheckResult,
} from '@splash360/db';
import { SYSTEM_ACTOR } from './ambassador';
import { parisDay } from './ticket-read';

/**
 * « Achat vérifié » (lot 20, ADR 0025) : rapprochement des tickets photographiés avec l'export
 * des ventes Splash360, dans la tâche périodique « ambassadeur ».
 *
 * - Au plus UNE page de l'export par passage (Splash360 : un export par minute et par identifiant
 *   client) : la journée la plus ancienne encore à lire, 100 ventes par page, ventes encaissées et
 *   annulées. Sur 429, le passage saute la lecture ; sur une autre erreur, il la journalise.
 * - Une journée n'est « complète » qu'après une lecture entière commencée une fois la journée
 *   terminée (heure de Paris) : l'ordre des ventes dans l'export n'est pas garanti.
 * - Rapprochement : même journée comptable, même numéro (normalisé), même total en centimes, dans
 *   un restaurant branché de l'enseigne. Vente encaissée → « verified » ; seulement annulée →
 *   « unpaid » (participation refusée) ; journée complète sans vente → « not_found » (l'équipe
 *   tranche). Sinon le ticket reste « pending » : jamais de crédit automatique en attendant.
 * - Enseigne sans restaurant branché sur Splash360, ou serveur sans identifiants : le ticket reste
 *   « pending » et la participation passe « à vérifier » par l'équipe.
 * Bornée et idempotente : chaque résultat est écrit par une mise à jour conditionnelle.
 */
export type SalesFetchResult =
  | { readonly ok: true; readonly page: Splash360SalesPage }
  | { readonly ok: false; readonly reason: 'rate_limited' | 'error'; readonly message: string };

/** Lecture d'une page de l'export des ventes d'une journée (un identifiant client Splash360). */
export interface SalesSource {
  fetchPage(jour: string, page: number): Promise<SalesFetchResult>;
}

export interface TicketCheckDeps {
  readonly ambassador: AmbassadorStore;
  readonly restaurants: RestaurantStore;
  /** Copie des ventes ; absente (ou `source` absente) = vérification impossible. */
  readonly sales?: PosSalesStore | undefined;
  readonly source?: SalesSource | null | undefined;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface TicketCheckRun {
  /** Une page de l'export a été lue pendant ce passage. */
  readonly fetched: boolean;
  readonly verified: number;
  readonly unpaid: number;
  readonly notFound: number;
  /** Participations passées « à vérifier » faute d'accès aux ventes. */
  readonly flagged: number;
}

export const UNPAID_REASON = 'Commande annulée en caisse';
const UNAVAILABLE_REASON = 'Ventes Splash360 non branchées : vérification par le restaurant';

/** Ventes pages de 100 (maximum de l'API). */
export const SALES_PAGE_SIZE = 100;

type Checkable = AmbassadorEntry & {
  readonly ticketDate: string;
  readonly ticketNumber: string;
  readonly ticketTotalCents: number;
};
const isCheckable = (e: AmbassadorEntry): e is Checkable =>
  e.ticketDate !== null && e.ticketNumber !== null && e.ticketTotalCents !== null;

/** Résultat du rapprochement d'un ticket avec les ventes copiées ; null = encore inconnu. */
export function matchTicket(
  entry: {
    readonly ticketDate: string;
    readonly ticketNumber: string;
    readonly ticketTotalCents: number;
  },
  sales: readonly PosSaleRecord[],
  restaurantIds: ReadonlySet<string>,
  dayComplete: boolean,
): { readonly result: TicketCheckResult; readonly sale: PosSaleRecord | null } | null {
  const same = sales.filter(
    (s) =>
      s.jourComptable === entry.ticketDate &&
      s.numero.trim().toUpperCase() === entry.ticketNumber.trim().toUpperCase() &&
      s.totalCents === entry.ticketTotalCents &&
      restaurantIds.has(s.restaurantId),
  );
  const paid = same.find((s) => s.status === 'confirmed');
  if (paid) return { result: 'verified', sale: paid };
  const deleted = same.find((s) => s.status === 'deleted');
  if (deleted) return { result: 'unpaid', sale: deleted };
  return dayComplete ? { result: 'not_found', sale: null } : null;
}

/** Avancement après lecture d'une page (voir la règle de complétude ci-dessus). */
export function nextCursor(
  cursor: PosSalesCursor,
  page: number,
  hasNextPage: boolean,
  passAfterDay: boolean,
): PosSalesCursor {
  if (hasNextPage) return { nextPage: page + 1, passAfterDay, complete: false };
  if (passAfterDay) return { nextPage: page, passAfterDay, complete: true };
  // Journée pas encore terminée au début de cette lecture : on recommencera depuis le début.
  return { ...cursor, nextPage: 0, passAfterDay: false, complete: false };
}

export async function verifyAmbassadorTickets(
  deps: TicketCheckDeps,
  now: Date,
  limit = 200,
): Promise<TicketCheckRun> {
  const run = { fetched: false, verified: 0, unpaid: 0, notFound: 0, flagged: 0 };
  const entries = (await deps.ambassador.pendingTicketChecks(limit)).filter(isCheckable);
  if (entries.length === 0) return run;
  const today = parisDay(now);

  // Restaurants branchés de chaque enseigne (identifiants Splash360).
  const live = new Map<string, ReadonlySet<string>>();
  for (const tenantId of new Set(entries.map((e) => e.tenantId))) {
    const list = await deps.restaurants.listByTenant(tenantId);
    live.set(tenantId, new Set(list.filter((r) => r.splash360Live).map((r) => r.splash360Id)));
  }
  const sales = deps.sales;
  const source = deps.source ?? null;
  const checkable: Checkable[] = [];
  for (const e of entries) {
    if (sales && source && (live.get(e.tenantId)?.size ?? 0) > 0) {
      checkable.push(e);
      continue;
    }
    const flagged = await deps.ambassador.flagTicketReview(e.tenantId, e.id, now, {
      type: 'ticket_checked',
      actor: SYSTEM_ACTOR,
      detail: { result: 'unavailable', reason: UNAVAILABLE_REASON },
    });
    if (flagged) run.flagged += 1;
  }
  if (!sales || !source || checkable.length === 0) return run;

  const cursors = new Map<string, PosSalesCursor>();
  const cursorOf = async (tenantId: string, jour: string) => {
    const key = `${tenantId}/${jour}`;
    let c = cursors.get(key);
    if (!c) {
      c = await sales.getCursor(tenantId, jour);
      cursors.set(key, c);
    }
    return c;
  };

  // Une seule page lue : la journée la plus ancienne encore incomplète.
  let target: Checkable | null = null;
  for (const e of checkable) {
    if (!(await cursorOf(e.tenantId, e.ticketDate)).complete) {
      target = e;
      break;
    }
  }
  if (target) {
    const { tenantId, ticketDate: jour } = target;
    const cursor = await cursorOf(tenantId, jour);
    const page = cursor.nextPage;
    const passAfterDay = page === 0 ? jour < today : cursor.passAfterDay;
    const result = await source.fetchPage(jour, page);
    if (result.ok) {
      run.fetched = true;
      const ids = live.get(tenantId) ?? new Set<string>();
      await sales.saveSales(
        tenantId,
        result.page.sales.filter((s) => ids.has(s.restaurantId)),
        now,
      );
      if (result.page.skipped > 0)
        deps.log?.('Ventes Splash360 ignorées (format inattendu)', {
          jour,
          page,
          skipped: result.page.skipped,
        });
      const next = nextCursor(cursor, page, result.page.hasNextPage, passAfterDay);
      await sales.saveCursor(tenantId, jour, next, now);
      cursors.set(`${tenantId}/${jour}`, next);
    } else if (result.reason === 'error') {
      deps.log?.('Export des ventes Splash360 indisponible', { jour, page, error: result.message });
    }
  }

  // Rapprochement de chaque ticket avec les ventes déjà copiées.
  for (const e of checkable) {
    try {
      const ids = live.get(e.tenantId) ?? new Set<string>();
      const found = await sales.findSales(e.tenantId, e.ticketDate, e.ticketNumber);
      const complete = (await cursorOf(e.tenantId, e.ticketDate)).complete;
      const match = matchTicket(e, found, ids, complete);
      if (!match) continue;
      const events: AmbassadorEventInput[] = [
        {
          type: 'ticket_checked',
          actor: SYSTEM_ACTOR,
          detail: {
            result: match.result,
            ...(match.sale ? { sale: match.sale.ticketId } : {}),
          },
        },
        ...(match.result === 'unpaid'
          ? [{ type: 'rejected' as const, actor: SYSTEM_ACTOR, detail: { reason: UNPAID_REASON } }]
          : []),
      ];
      const recorded = await deps.ambassador.recordTicketCheck(e.tenantId, e.id, {
        at: now,
        result: match.result,
        events,
      });
      if (!recorded) continue;
      if (match.result === 'verified') run.verified += 1;
      else if (match.result === 'unpaid') run.unpaid += 1;
      else run.notFound += 1;
    } catch (error) {
      deps.log?.('Ticket ambassadeur non vérifié', { entryId: e.id, error: String(error) });
    }
  }
  return run;
}
