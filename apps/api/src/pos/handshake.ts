import type { OrderReader, PosTicketStore, RestaurantStore } from '@splash360/db';
import type { PosGateway } from './gateway';

/**
 * Avant paiement (ADR 0018) : la commande est déposée en caisse, puis on attend que la caisse
 * la déclare « prête ». Le client ne peut payer qu'à ce moment ; sinon la commande est annulée.
 */
export interface HandshakeDeps {
  readonly orders: OrderReader;
  readonly restaurants: RestaurantStore;
  readonly tickets: PosTicketStore;
  readonly pos: PosGateway;
  readonly now?: (() => Date) | undefined;
  readonly log?: ((message: string, detail?: Record<string, unknown>) => void) | undefined;
  readonly timing?: Partial<PosTiming> | undefined;
}

export interface PosTiming {
  /** Délai maximal pour que la caisse soit prête, avant paiement (défaut 60 s). */
  readonly readyTimeoutMs: number;
  /** Délai maximal de confirmation après l'envoi du paiement (défaut 5 min). */
  readonly confirmTimeoutMs: number;
  /** Intervalle minimal entre deux interrogations de la caisse pour une commande (défaut 1 s). */
  readonly minCheckIntervalMs: number;
}

export const DEFAULT_POS_TIMING: PosTiming = {
  readyTimeoutMs: 60_000,
  confirmTimeoutMs: 60_000,
  minCheckIntervalMs: 1000,
};

export function posTiming(deps: { timing?: Partial<PosTiming> | undefined }): PosTiming {
  return { ...DEFAULT_POS_TIMING, ...deps.timing };
}

/** Journal d'un dépôt commencé sans ticket : jamais redéposé, vérification en caisse. */
export const POS_UNCERTAIN_LOG =
  'Dépôt en caisse incertain : jamais redéposé ; si la commande est en attente en caisse, l’annuler en caisse';

export type OpenOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Dépose la commande en caisse. En cas d'échec, la commande (non payée) est annulée. */
export async function openPosTicket(
  deps: HandshakeDeps,
  tenantId: string,
  orderId: string,
): Promise<OpenOutcome> {
  const now = deps.now ?? (() => new Date());
  if (await deps.tickets.getTicket(tenantId, orderId)) return { ok: true };
  // Une seule requête dépose la commande ; les autres attendent son ticket (pas de doublon).
  // Un second `submitcommande` avec le même numéro crée une seconde commande en caisse
  // (Splash360, 26/11) : un dépôt commencé n'est jamais refait automatiquement.
  const reservation = await deps.tickets.reserveOpening(tenantId, orderId, now());
  if (reservation === 'in_progress') return { ok: true };
  if (reservation === 'abandoned') {
    deps.log?.(POS_UNCERTAIN_LOG, { orderId });
    await deps.tickets.cancelForPos(tenantId, orderId, 'pos_uncertain');
    return { ok: false, error: 'pos_uncertain' };
  }
  try {
    const order = await deps.orders.getOrderDetail(tenantId, orderId);
    const restaurant = order ? await deps.restaurants.findById(tenantId, order.restaurantId) : null;
    if (!order || !restaurant) throw new Error('Commande ou restaurant introuvable');
    const { ticketId } = await deps.pos.openTicket(order, restaurant);
    await deps.tickets.openTicket(tenantId, orderId, ticketId, now());
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // La caisse a pu recevoir la commande (réponse perdue) : elle resterait « en attente »
    // (standby), annulable seulement en caisse ; alerte au back-office (`posToCancel`).
    deps.log?.('Dépôt en caisse impossible : commande annulée, à annuler en caisse si reçue', {
      orderId,
      error: message,
    });
    await deps.tickets.cancelForPos(tenantId, orderId, 'pos_unavailable');
    return { ok: false, error: message };
  }
}

/** waiting : la caisse n'a pas encore répondu ; ready : paiement possible ; unavailable : annulée. */
export type Readiness = 'waiting' | 'ready' | 'unavailable';

/**
 * Avant paiement en ligne : dépose la commande en caisse si ce n'est pas encore fait, puis
 * interroge la caisse (au plus une fois par `minCheckIntervalMs`) jusqu'à « ready ».
 * Au-delà de `readyTimeoutMs`, ou si la caisse refuse, la commande (non payée) est annulée.
 */
export async function checkReadiness(
  deps: HandshakeDeps,
  tenantId: string,
  orderId: string,
): Promise<Readiness> {
  const now = deps.now ?? (() => new Date());
  const timing = posTiming(deps);
  const order = await deps.orders.getOrderDetail(tenantId, orderId);
  if (!order || order.status === 'cancelled') return 'unavailable';
  // Déjà payée, ou à payer sur place (la caisse est suivie par l'envoi) : rien à attendre ici.
  if (order.paymentMethod === 'on_site' || !UNPAID.includes(order.status)) return 'ready';
  const restaurant = await deps.restaurants.findById(tenantId, order.restaurantId);
  if (!restaurant) return 'unavailable';

  let ticket = await deps.tickets.getTicket(tenantId, orderId);
  if (!ticket) {
    const opened = await openPosTicket(deps, tenantId, orderId);
    if (!opened.ok) return 'unavailable';
    ticket = await deps.tickets.getTicket(tenantId, orderId);
    // Dépôt en cours dans une autre requête : on attend son ticket.
    if (!ticket) return 'waiting';
  }
  if (ticket.phase === 'failed') return 'unavailable';
  if (ticket.phase !== 'waiting') return 'ready';

  const at = now();
  const fail = async (reason: string, raw: string | null) => {
    await deps.tickets.setPhase(tenantId, orderId, 'failed', at, {
      lastStatus: raw,
      error: reason,
    });
    await deps.tickets.cancelForPos(tenantId, orderId, reason);
    deps.log?.('La caisse n’a pas accepté la commande : annulée', { orderId, reason });
    return 'unavailable' as const;
  };
  const expired = at.getTime() - ticket.openedAt.getTime() > timing.readyTimeoutMs;
  if (ticket.checkedAt && at.getTime() - ticket.checkedAt.getTime() < timing.minCheckIntervalMs) {
    return expired ? fail('pos_not_ready', ticket.lastStatus) : 'waiting';
  }
  try {
    const status = await deps.pos.ticketStatus({
      ticketId: ticket.ticketId,
      restaurant,
      openedAt: ticket.openedAt,
      paymentSentAt: null,
    });
    if (status.state === 'ready' || status.state === 'confirmed') {
      await deps.tickets.setPhase(tenantId, orderId, 'ready', at, { lastStatus: status.raw });
      return 'ready';
    }
    if (status.state === 'failed') return fail('pos_refused', status.raw);
    if (expired) return fail('pos_not_ready', status.raw);
    await deps.tickets.recordCheck(tenantId, orderId, at, status.raw);
    return 'waiting';
  } catch (error) {
    deps.log?.('Statut de caisse illisible', { orderId, error: String(error) });
    if (expired) return fail('pos_not_ready', null);
    await deps.tickets.recordCheck(tenantId, orderId, at, null);
    return 'waiting';
  }
}

const UNPAID = ['pending_payment', 'payment_failed'];
