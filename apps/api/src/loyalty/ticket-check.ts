import type { Splash360SalesPage } from '@splash360/api-menu';
import {
  FIRST_SALES_PAGE,
  type AmbassadorEntry,
  type AmbassadorEventInput,
  type AmbassadorStore,
  type PosSaleRecord,
  type PosSalesCursor,
  type PosSalesStore,
  type RestaurantStore,
  type TicketCheckResult,
} from '@splash360/db';
import { SYSTEM_ACTOR } from './ambassador';
import { addDays, businessDay, isBusinessDayOver, receiptBusinessDays } from './business-day';

/**
 * « Achat vérifié » (lot 20, ADR 0025) : rapprochement des tickets identifiés (photo du ticket ou
 * QR de la borne) avec l'export des ventes Splash360, dans la tâche périodique « ambassadeur ».
 *
 * - Le rapprochement se fait par `ticket_id` (sans casse), dans un restaurant branché de
 *   l'enseigne, quelle que soit la journée où la vente a été copiée. La journée ne sert qu'à choisir
 *   quelle partie de l'export lire : journée comptable du ticket (avant 02:00 = la veille), ou, si
 *   l'heure est illisible, la date imprimée et la veille ; pour un QR (sans date), la journée
 *   comptable de la participation et la précédente.
 * - Au plus UNE page de l'export par passage (Splash360 : un export par minute et par identifiant
 *   client) : la journée la plus ancienne encore à lire, 100 ventes par page (pages à partir de 1),
 *   ventes encaissées et annulées. Sur 429, le passage saute la lecture ; sur une autre erreur, il la
 *   journalise.
 * - Une journée n'est « complète » qu'après une lecture entière commencée une fois la journée
 *   terminée (02:00, heure de Paris, le lendemain) : l'ordre des ventes n'est pas garanti.
 * - Vente encaissée → « verified » ; seulement annulée → « unpaid » (participation refusée) ;
 *   toutes les journées possibles complètes sans la vente → « not_found » (l'équipe tranche).
 *   Sinon le ticket reste « pending » : jamais de crédit automatique en attendant.
 * - Enseigne sans restaurant branché sur Splash360, ou serveur sans identifiants : le ticket reste
 *   « pending » et la participation passe « à vérifier » par l'équipe.
 * Bornée et idempotente : chaque résultat est écrit par une mise à jour conditionnelle.
 */
export type SalesFetchResult =
  | { readonly ok: true; readonly page: Splash360SalesPage }
  | { readonly ok: false; readonly reason: 'rate_limited' | 'error'; readonly message: string };

/** Lecture d'une page (à partir de 1) de l'export des ventes d'une journée. */
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

type Checkable = AmbassadorEntry & { readonly ticketId: string };
const isCheckable = (e: AmbassadorEntry): e is Checkable => e.ticketId !== null;

/** Journées comptables de l'export où chercher la vente d'un ticket (la plus ancienne d'abord). */
export function ticketBusinessDays(entry: {
  readonly ticketDate: string | null;
  readonly ticketTime: string | null;
  readonly createdAt: Date;
}): readonly string[] {
  if (entry.ticketDate) return [...receiptBusinessDays(entry.ticketDate, entry.ticketTime)].sort();
  const day = businessDay(entry.createdAt);
  return [addDays(day, -1), day];
}

/** Résultat du rapprochement d'un ticket ; null = encore inconnu. */
export function matchTicket(
  entry: { readonly ticketId: string; readonly ticketTotalCents: number | null },
  sale: PosSaleRecord | null,
  restaurantIds: ReadonlySet<string>,
  daysComplete: boolean,
): {
  readonly result: TicketCheckResult;
  readonly sale: PosSaleRecord | null;
  /** Le total de la vente diffère du total lu sur la photo (journalisé, sans effet). */
  readonly totalDiffers: boolean;
} | null {
  const same =
    sale &&
    sale.ticketId.toLowerCase() === entry.ticketId.toLowerCase() &&
    restaurantIds.has(sale.restaurantId)
      ? sale
      : null;
  if (same) {
    const totalDiffers =
      entry.ticketTotalCents !== null && entry.ticketTotalCents !== same.totalCents;
    return {
      result: same.status === 'confirmed' ? 'verified' : 'unpaid',
      sale: same,
      totalDiffers,
    };
  }
  return daysComplete ? { result: 'not_found', sale: null, totalDiffers: false } : null;
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
  return { ...cursor, nextPage: FIRST_SALES_PAGE, passAfterDay: false, complete: false };
}

export async function verifyAmbassadorTickets(
  deps: TicketCheckDeps,
  now: Date,
  limit = 200,
): Promise<TicketCheckRun> {
  const run = { fetched: false, verified: 0, unpaid: 0, notFound: 0, flagged: 0 };
  const entries = (await deps.ambassador.pendingTicketChecks(limit)).filter(isCheckable);
  if (entries.length === 0) return run;

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

  // Une seule page lue : la journée la plus ancienne encore incomplète, toutes enseignes.
  let target: { readonly tenantId: string; readonly jour: string } | null = null;
  for (const e of checkable) {
    for (const jour of ticketBusinessDays(e)) {
      if ((await cursorOf(e.tenantId, jour)).complete) continue;
      if (!target || jour < target.jour) target = { tenantId: e.tenantId, jour };
      break;
    }
  }
  if (target) {
    const { tenantId, jour } = target;
    const cursor = await cursorOf(tenantId, jour);
    const page = cursor.nextPage;
    const passAfterDay =
      page === FIRST_SALES_PAGE ? isBusinessDayOver(jour, now) : cursor.passAfterDay;
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
      const sale = await sales.findSale(e.tenantId, e.ticketId);
      let complete = true;
      for (const jour of ticketBusinessDays(e))
        complete = complete && (await cursorOf(e.tenantId, jour)).complete;
      const match = matchTicket(e, sale, ids, complete);
      if (!match) continue;
      const events: AmbassadorEventInput[] = [
        {
          type: 'ticket_checked',
          actor: SYSTEM_ACTOR,
          detail: {
            result: match.result,
            ...(match.sale ? { jour: match.sale.jourComptable } : {}),
            ...(match.totalDiffers && match.sale
              ? { saleTotalCents: match.sale.totalCents, totalDiffers: true }
              : {}),
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
