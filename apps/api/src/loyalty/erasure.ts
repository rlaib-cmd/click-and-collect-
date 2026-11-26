import type { LoyaltyProgram, LoyaltyProvider, LoyaltyTenant } from '@splash360/api-loyalty';
import type {
  AmbassadorStore,
  AuditActor,
  MemberSessionStore,
  ProximityStore,
  StripeCustomerStore,
} from '@splash360/db';
import { PARTNER_ERASURE_DAYS } from '@splash360/contracts';
import type { CardGateway } from '../payments/cards';

/**
 * Effacement d'un membre du club (droit à l'effacement, ADR 0028), commun au back-office et à
 * l'application (« Supprimer mon compte », exigence 5.1.1(v) de l'App Store).
 */
export interface MemberErasureDeps {
  readonly loyalty: LoyaltyProvider;
  readonly memberSessions?: Pick<MemberSessionStore, 'bump'> | undefined;
  readonly proximity?: Pick<ProximityStore, 'forgetMember'> | undefined;
  readonly ambassador?: Pick<AmbassadorStore, 'forgetMember'> | undefined;
  readonly cardGateway?: Pick<CardGateway, 'listCards' | 'detach'> | undefined;
  readonly stripeCustomers?: Pick<StripeCustomerStore, 'find' | 'forget'> | undefined;
  readonly audit: (entry: {
    readonly tenantId: string;
    readonly actor: AuditActor;
    readonly action: string;
    readonly target: string | null;
    readonly detail: Record<string, unknown> | null;
  }) => Promise<void>;
}

export interface MemberErasure {
  /** Compte effacé par cet appel ; faux s'il n'existait pas (ou plus) : rien d'autre n'a changé. */
  readonly erased: boolean;
  /**
   * YouFID : la fiche client chez le partenaire ne s'efface pas par l'API (ADR 0026) ; la demande
   * est notée au journal (`loyalty.erasure_requested`) pour que l'équipe la transmette à Splash360.
   */
  readonly partnerErasureRequested: boolean;
}

/** Auteur des actions faites par le client lui-même depuis l'application. */
export const CLIENT_ACTOR: AuditActor = { id: null, email: 'client' };

/** Tours de détachement des cartes (20 cartes par lecture chez Stripe). */
const CARD_ROUNDS = 5;

async function detachCards(deps: MemberErasureDeps, tenantId: string, memberId: string) {
  const { cardGateway, stripeCustomers } = deps;
  if (!cardGateway || !stripeCustomers) return 0;
  const customerId = await stripeCustomers.find(tenantId, memberId);
  if (!customerId) return 0;
  let detached = 0;
  for (let round = 0; round < CARD_ROUNDS; round++) {
    const cards = await cardGateway.listCards(customerId);
    if (cards.length === 0) break;
    for (const card of cards) await cardGateway.detach(card.id);
    detached += cards.length;
  }
  await stripeCustomers.forget(tenantId, memberId);
  return detached;
}

/**
 * Efface le membre. Les cartes enregistrées (appel Stripe, seul à pouvoir échouer pour une cause
 * extérieure) sont détachées d'abord : en cas d'échec, rien n'est effacé et la demande peut être
 * refaite. Puis : Ambassadeur (profil, participations en attente ; décidées anonymisées), « à
 * proximité » (appareils, événements), compte chez le fournisseur, et enfin toutes les sessions du
 * membre révoquées. Chaque étape est idempotente ; l'action est journalisée avec son auteur.
 */
export async function eraseLoyaltyMember(
  deps: MemberErasureDeps,
  tenant: LoyaltyTenant,
  program: Pick<LoyaltyProgram, 'source'>,
  memberId: string,
  actor: AuditActor,
): Promise<MemberErasure> {
  const cardsDetached = await detachCards(deps, tenant.id, memberId);
  const ambassador = (await deps.ambassador?.forgetMember(tenant.id, memberId)) ?? {
    deletedEntries: 0,
    anonymisedEntries: 0,
  };
  await deps.proximity?.forgetMember(tenant.id, memberId);
  const erased = await deps.loyalty.deleteMember(tenant, memberId);
  if (!erased) return { erased: false, partnerErasureRequested: false };
  await deps.memberSessions?.bump(tenant.id, memberId);

  await deps.audit({
    tenantId: tenant.id,
    actor,
    action: 'loyalty.member.delete',
    target: memberId,
    detail: {
      cardsDetached,
      ambassadorEntriesDeleted: ambassador.deletedEntries,
      ambassadorEntriesAnonymised: ambassador.anonymisedEntries,
    },
  });
  const partnerErasureRequested = program.source === 'youfid';
  if (partnerErasureRequested) {
    await deps.audit({
      tenantId: tenant.id,
      actor,
      action: 'loyalty.erasure_requested',
      target: memberId,
      detail: { partner: 'youfid', dueWithinDays: PARTNER_ERASURE_DAYS },
    });
  }
  return { erased: true, partnerErasureRequested };
}
