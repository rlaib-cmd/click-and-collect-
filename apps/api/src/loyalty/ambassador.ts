import type { LoyaltyProvider, LoyaltyTenant } from '@splash360/api-loyalty';
import type { AmbassadorEntry, AmbassadorStore } from '@splash360/db';

export interface AmbassadorDeps {
  readonly ambassador: AmbassadorStore;
  readonly loyalty: LoyaltyProvider;
}

export type ConfirmResult =
  | { readonly ok: true; readonly entry: AmbassadorEntry }
  | { readonly ok: false; readonly error: 'not_pending' | 'unknown_member' };

/**
 * Confirme une participation « Ambassadeur » et crédite son bonus (lot 15, ADR 0019).
 *
 * Seul point d'entrée qui crédite des points : la participation passe de « pending » à
 * « confirmed » de façon atomique, donc le bonus n'est crédité qu'une fois, même appelé deux fois.
 * Aucun appelant automatique n'existe encore : il sera branché sur la vérification de la mention
 * Instagram et du QR du ticket Splash360 (questions-en-attente.md, n° 17).
 */
export async function confirmAmbassadorEntry(
  deps: AmbassadorDeps,
  tenant: LoyaltyTenant,
  entryId: string,
  at: Date,
): Promise<ConfirmResult> {
  const entry = await deps.ambassador.decide(tenant.id, entryId, 'confirmed', at);
  if (!entry) return { ok: false, error: 'not_pending' };
  const credited = await deps.loyalty.adjustPoints(
    tenant,
    entry.memberId,
    entry.bonusPoints,
    `Story Instagram (ticket ${entry.ticketRef})`,
  );
  if (!credited.ok) return { ok: false, error: 'unknown_member' };
  return { ok: true, entry };
}

/** Refus (story sans mention, ticket non valable) : aucun point, décision définitive. */
export async function rejectAmbassadorEntry(
  store: AmbassadorStore,
  tenantId: string,
  entryId: string,
  at: Date,
): Promise<boolean> {
  return (await store.decide(tenantId, entryId, 'rejected', at)) !== null;
}
