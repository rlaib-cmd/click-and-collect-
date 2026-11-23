import { Buffer } from 'node:buffer';
import type { OperationalStatus } from '@splash360/core';
import type { OrderDetail, Restaurant } from '@splash360/db';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Caisse Splash360 (lot 14, ADR 0018). Parcours imposé par Splash360 :
 * 1. dépôt de la commande « en attente » → ticket ;
 * 2. la caisse passe le ticket à « ready » : elle peut accepter la commande, le client peut payer ;
 * 3. notification du paiement (vide pour un paiement sur place) ;
 * 4. la caisse passe le ticket à « confirmed » : commande intégrée.
 * Les phases sont suivies sur la commande (`PosTicketStore`), le séquencement est dans `handshake.ts`.
 */
export type PosTicketState = 'pending' | 'ready' | 'confirmed' | 'failed';

export type PosPayment =
  | {
      readonly method: 'card';
      readonly amountCents: number;
      /** Identifiant du paiement Stripe, transmis à la caisse comme détail du règlement. */
      readonly reference: string;
    }
  | { readonly method: 'on_site' };

export interface PosTicketRef {
  readonly ticketId: string;
  readonly restaurant: Restaurant;
}

export interface PosGateway {
  /** Dépose la commande en attente ; renvoie le ticket de la caisse. */
  openTicket(order: OrderDetail, restaurant: Restaurant): Promise<{ ticketId: string }>;
  ticketStatus(
    ticket: PosTicketRef & { readonly openedAt: Date; readonly paymentSentAt: Date | null },
  ): Promise<{ state: PosTicketState; raw: string | null }>;
  submitPayment(ticket: PosTicketRef, payment: PosPayment): Promise<void>;
}

export class PosRejectedError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PosRejectedError';
  }
}

export interface DemoPosOptions {
  readonly log?: (m: string) => void;
  readonly now?: () => Date;
  /** Délai simulé avant que la caisse soit prête (défaut 2 s). */
  readonly readyAfterMs?: number;
  /** Délai simulé avant la confirmation après paiement (défaut 1,5 s). */
  readonly confirmAfterMs?: number;
}

/**
 * Caisse de démonstration : même parcours que Splash360 (en attente → prête → confirmée),
 * calculé d'après l'heure du dépôt et du paiement, donc sans état (plusieurs instances possibles).
 */
export function createDemoPosGateway(
  options: DemoPosOptions = {},
): PosGateway & { submitted: string[]; payments: PosPayment[] } {
  const submitted: string[] = [];
  const payments: PosPayment[] = [];
  const now = options.now ?? (() => new Date());
  const readyAfter = options.readyAfterMs ?? 2000;
  const confirmAfter = options.confirmAfterMs ?? 1500;
  const log = options.log ?? (() => undefined);
  return {
    submitted,
    payments,
    openTicket(order) {
      submitted.push(order.id);
      log(`[caisse de démonstration] commande n° ${order.number} déposée`);
      return Promise.resolve({ ticketId: `DEMO-${order.number}-${order.id.slice(0, 8)}` });
    },
    ticketStatus({ openedAt, paymentSentAt }) {
      const t = now().getTime();
      if (paymentSentAt && t - paymentSentAt.getTime() >= confirmAfter)
        return Promise.resolve({ state: 'confirmed', raw: 'confirmed' });
      if (paymentSentAt || t - openedAt.getTime() >= readyAfter)
        return Promise.resolve({ state: 'ready', raw: 'ready' });
      return Promise.resolve({ state: 'pending', raw: 'pending' });
    },
    submitPayment({ ticketId }, payment) {
      payments.push(payment);
      log(`[caisse de démonstration] paiement reçu pour ${ticketId}`);
      return Promise.resolve();
    },
  };
}

/** Restaurant branché (et identifiants posés) : vraie caisse ; sinon démonstration. */
export function createRoutingPosGateway(input: {
  readonly demo: PosGateway;
  readonly live: PosGateway | null;
}): PosGateway {
  const pick = (restaurant: Restaurant) =>
    restaurant.splash360Live && input.live ? input.live : input.demo;
  return {
    openTicket: (order, restaurant) => pick(restaurant).openTicket(order, restaurant),
    ticketStatus: (ticket) => pick(ticket.restaurant).ticketStatus(ticket),
    submitPayment: (ticket, payment) => pick(ticket.restaurant).submitPayment(ticket, payment),
  };
}

/** Statuts que la caisse peut renvoyer (proposition de contrat). */
export const POS_STATUSES: readonly OperationalStatus[] = [
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
];

/** Signature HMAC-SHA256 du corps brut, en hexadécimal (en-tête `x-splash360-signature`). */
export function signPosPayload(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyPosSignature(
  secret: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signPosPayload(secret, rawBody), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
