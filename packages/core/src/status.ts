import type { OrderMode } from './fees';

/** Statuts d'une commande (section 3 du cahier des charges). */
export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'payment_failed'
  | 'cancelled'
  | 'refunded';

/** Statuts que l'équipe (back-office) ou la caisse peut appliquer. */
export type OperationalStatus =
  'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';

const FLOW: Record<OrderMode, readonly OrderStatus[]> = {
  pickup: ['paid', 'accepted', 'preparing', 'ready', 'completed'],
  delivery: ['paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'],
};

export type TransitionCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: 'not_paid' | 'finished' | 'backwards' | 'invalid_for_mode';
    };

/**
 * Changement de statut opérationnel. On avance dans le parcours (on peut sauter des étapes,
 * la caisse ne les envoie pas toutes) mais on ne revient jamais en arrière.
 * L'annulation est possible tant que la commande n'est pas remise ; le remboursement est un acte séparé.
 */
export function checkTransition(
  mode: OrderMode,
  from: OrderStatus,
  to: OperationalStatus,
): TransitionCheck {
  if (from === 'pending_payment' || from === 'payment_failed')
    return { ok: false, error: 'not_paid' };
  if (from === 'completed' || from === 'cancelled' || from === 'refunded')
    return { ok: false, error: 'finished' };
  if (to === 'cancelled') return { ok: true };
  const flow = FLOW[mode];
  const target = flow.indexOf(to);
  if (target === -1) return { ok: false, error: 'invalid_for_mode' };
  if (target <= flow.indexOf(from)) return { ok: false, error: 'backwards' };
  return { ok: true };
}

export function isFinished(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'refunded';
}
