import type { OperationalStatus } from '@splash360/core';
import type { OrderDetail, Restaurant } from '@splash360/db';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Caisse Splash360 : dépôt des commandes payées et retour des statuts (section 7).
 * Le format réel dépend de la documentation Splash360 (en attente) ; le contrat proposé
 * est décrit dans docs/api-splash360/contrat-commande-en-ligne.md.
 */
export interface PosGateway {
  /** Dépose une commande payée ; renvoie la référence de la caisse. Doit être idempotent par `orderId`. */
  submitOrder(order: OrderDetail, restaurant: Restaurant): Promise<{ reference: string }>;
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

/** Charge utile envoyée à la caisse (proposition de contrat). */
export function toPosPayload(order: OrderDetail, restaurant: Restaurant) {
  return {
    externalId: order.id,
    channel: 'online_ordering',
    restaurantId: restaurant.splash360Id,
    number: order.number,
    mode: order.mode,
    requestedAt: order.requestedSlot,
    estimatedAt: order.estimatedAt,
    paid: true,
    customer: order.customer,
    deliveryAddress: order.deliveryAddress,
    lines: order.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      totalCents: l.totalCents,
      note: l.note,
      options: l.options,
    })),
    totals: order.totals,
  };
}

/** Implémentation de démonstration : accepte tout et renvoie une référence locale. */
export function createDemoPosGateway(
  log: (m: string) => void = () => undefined,
): PosGateway & { submitted: string[] } {
  const submitted: string[] = [];
  return {
    submitted,
    submitOrder(order) {
      submitted.push(order.id);
      log(`[caisse de démonstration] commande n° ${order.number} reçue`);
      return Promise.resolve({ reference: `DEMO-${order.number}-${order.id.slice(0, 8)}` });
    },
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
