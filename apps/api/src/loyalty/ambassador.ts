import type { LoyaltyProvider, LoyaltyTenant } from '@splash360/api-loyalty';
import type {
  AdminAmbassadorEntryDto,
  AmbassadorEntryDto,
  AmbassadorStage,
} from '@splash360/contracts';
import type {
  AmbassadorEntry,
  AmbassadorEvent,
  AmbassadorStore,
  StoryCheckResult,
} from '@splash360/db';

export interface AmbassadorDeps {
  readonly ambassador: AmbassadorStore;
  readonly loyalty: LoyaltyProvider;
}

/** Auteurs automatiques journalisés dans l'historique. */
export const SYSTEM_ACTOR = 'système';
export const CLIENT_ACTOR = 'client';

/**
 * Contrôle « la story est-elle toujours en ligne ? » (lot 17, ADR 0022). Tant que l'API Meta
 * n'est pas branchée (questions-en-attente n° 17), la story est réputée en ligne : le restaurant
 * garde la main avec « Refuser » jusqu'au crédit. Une implémentation Meta remplacera celle-ci.
 */
export interface StoryChecker {
  check(entry: AmbassadorEntry): Promise<StoryCheckResult>;
}

export const manualStoryChecker: StoryChecker = { check: () => Promise.resolve('online') };

export function stageOf(e: AmbassadorEntry): AmbassadorStage {
  if (e.status === 'confirmed') return 'credited';
  if (e.status === 'rejected') return 'rejected';
  if (e.mentionReceivedAt) return 'mention_received';
  return e.needsReview ? 'to_review' : 'pending';
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export const toEntryDto = (e: AmbassadorEntry): AmbassadorEntryDto => ({
  id: e.id,
  status: e.status,
  stage: stageOf(e),
  ticketRef: e.ticketRef,
  bonusPoints: e.bonusPoints,
  createdAt: e.createdAt.toISOString(),
  mentionReceivedAt: iso(e.mentionReceivedAt),
  creditDueAt: iso(e.creditDueAt),
  photoVerdict: e.photoVerdict,
  decidedAt: iso(e.decidedAt),
  ticketCheck: e.ticketCheck,
});

export const toAdminEntryDto = (
  e: AmbassadorEntry,
  events: readonly AmbassadorEvent[],
): AdminAmbassadorEntryDto => ({
  ...toEntryDto(e),
  memberId: e.memberId,
  instagramHandle: e.instagramHandle,
  scanned: e.ticketQr !== null,
  mentionBy: e.mentionBy,
  checkDueAt: iso(e.checkDueAt),
  checkResult: e.checkResult,
  photoReason: e.photoReason,
  needsReview: e.needsReview,
  ticketDate: e.ticketDate,
  ticketNumber: e.ticketNumber,
  ticketTotalCents: e.ticketTotalCents,
  events: events
    .filter((ev) => ev.entryId === e.id)
    .map((ev) => ({ type: ev.type, actor: ev.actor, detail: ev.detail, at: ev.at.toISOString() })),
});

export type ConfirmResult =
  | { readonly ok: true; readonly entry: AmbassadorEntry }
  | { readonly ok: false; readonly error: 'not_pending' | 'unknown_member' };

/**
 * Confirme une participation « Ambassadeur » et crédite son bonus (lots 15 et 17).
 *
 * Seul point d'entrée qui crédite des points : la participation passe de « pending » à
 * « confirmed » de façon atomique (avec son événement « credited »), donc le bonus n'est crédité
 * qu'une fois, même appelé deux fois en même temps.
 */
export async function confirmAmbassadorEntry(
  deps: AmbassadorDeps,
  tenant: LoyaltyTenant,
  entryId: string,
  at: Date,
  actor: string = SYSTEM_ACTOR,
): Promise<ConfirmResult> {
  const current = await deps.ambassador.getEntry(tenant.id, entryId);
  if (!current) return { ok: false, error: 'not_pending' };
  const entry = await deps.ambassador.decide(tenant.id, entryId, 'confirmed', at, {
    type: 'credited',
    actor,
    detail: { points: current.bonusPoints },
  });
  if (!entry) return { ok: false, error: 'not_pending' };
  const credited = await deps.loyalty.adjustPoints(
    tenant,
    entry.memberId,
    entry.bonusPoints,
    `Story Instagram (ticket ${entry.ticketRef})`,
  );
  if (!credited.ok) {
    await deps.ambassador.addEvent(tenant.id, entryId, {
      type: 'credit_failed',
      actor: SYSTEM_ACTOR,
      detail: { reason: 'Membre introuvable au club' },
    });
    return { ok: false, error: 'unknown_member' };
  }
  return { ok: true, entry };
}

/** Refus (story absente ou retirée, ticket non valable) : aucun point, décision définitive. */
export async function rejectAmbassadorEntry(
  store: AmbassadorStore,
  tenantId: string,
  entryId: string,
  at: Date,
  actor: string,
  reason?: string,
): Promise<AmbassadorEntry | null> {
  return store.decide(tenantId, entryId, 'rejected', at, {
    type: 'rejected',
    actor,
    detail: reason ? { reason } : {},
  });
}

/** « Mention reçue » : départ des délais de contrôle et de crédit réglés par l'enseigne. */
export async function markMentionReceived(
  store: AmbassadorStore,
  tenantId: string,
  entryId: string,
  at: Date,
  by: string,
): Promise<AmbassadorEntry | null> {
  const s = await store.getSettings(tenantId);
  const hours = (h: number) => new Date(at.getTime() + h * 3600_000);
  return store.markMention(tenantId, entryId, {
    at,
    by,
    checkDueAt: hours(s.checkAfterHours),
    creditDueAt: hours(s.creditAfterHours),
  });
}

export interface ProcessAmbassadorDeps extends AmbassadorDeps {
  readonly storyChecker?: StoryChecker;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface ProcessAmbassadorResult {
  readonly checked: number;
  readonly credited: number;
  readonly rejected: number;
}

/**
 * Tâche périodique « ambassadeur » (lot 17) : contrôle de la story à l'échéance, puis crédit à
 * l'échéance. Bornée (`limit` participations par passage) et idempotente : chaque étape ne passe
 * qu'une fois (mises à jour conditionnelles), deux passages simultanés ne créditent pas deux fois.
 */
export async function processAmbassadorEntries(
  deps: ProcessAmbassadorDeps,
  now: Date,
  limit = 20,
): Promise<ProcessAmbassadorResult> {
  const checker = deps.storyChecker ?? manualStoryChecker;
  let checked = 0;
  let credited = 0;
  let rejected = 0;
  for (const entry of await deps.ambassador.dueEntries(now, limit)) {
    try {
      let current: AmbassadorEntry = entry;
      if (!current.checkedAt && current.checkDueAt && current.checkDueAt <= now) {
        const result = await checker.check(current);
        const recorded = await deps.ambassador.recordCheck(entry.tenantId, entry.id, {
          at: now,
          result,
          actor: SYSTEM_ACTOR,
        });
        if (!recorded) continue;
        checked += 1;
        current = recorded;
        if (result === 'removed') {
          const r = await rejectAmbassadorEntry(
            deps.ambassador,
            entry.tenantId,
            entry.id,
            now,
            SYSTEM_ACTOR,
            'Story retirée avant le crédit',
          );
          if (r) rejected += 1;
          continue;
        }
      }
      if (current.checkedAt && current.creditDueAt && current.creditDueAt <= now) {
        const r = await confirmAmbassadorEntry(
          deps,
          { id: entry.tenantId, splash360Id: entry.splash360Id },
          entry.id,
          now,
        );
        if (r.ok) credited += 1;
      }
    } catch (error) {
      deps.log?.('Participation ambassadeur non traitée', {
        entryId: entry.id,
        error: String(error),
      });
    }
  }
  return { checked, credited, rejected };
}
