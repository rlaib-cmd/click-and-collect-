import type { OperationsStore } from '@splash360/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { notifyStatus, type NotifyDeps } from '../notifications/service';
import { POS_STATUSES, verifyPosSignature } from '../pos/gateway';

export interface PosRoutesDeps extends NotifyDeps {
  readonly operations: OperationsStore;
  /** Secret partagé avec Splash360 ; absent = route désactivée. */
  readonly posWebhookSecret: string | null;
}

const statusSchema = z.object({
  reference: z.string().min(1).max(100),
  status: z.enum(POS_STATUSES as unknown as [string, ...string[]]),
});

/**
 * Retour des statuts depuis la caisse ou l'écran cuisine (section 7). Corps signé
 * HMAC-SHA256 (en-tête x-splash360-signature). Contrat proposé : docs/api-splash360/.
 */
export function posRoutes(deps: PosRoutesDeps) {
  return new Hono().post('/status', async (c) => {
    if (!deps.posWebhookSecret) return c.json({ received: false }, 503);
    const raw = await c.req.text();
    if (!verifyPosSignature(deps.posWebhookSecret, raw, c.req.header('x-splash360-signature'))) {
      return c.json({ received: false }, 401);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ received: false }, 400);
    }
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return c.json({ received: false }, 400);
    const order = await deps.operations.findByPosReference(parsed.data.reference);
    if (!order) return c.json({ received: false, outcome: 'unknown_reference' }, 404);
    const status = parsed.data.status as (typeof POS_STATUSES)[number];
    const change = await deps.operations.changeStatus(order.tenantId, order.orderId, status, 'pos');
    // Un statut déjà appliqué ou dépassé n'est pas une erreur (renvoi, ordre d'arrivée) : 200 pour ne pas boucler.
    if (!change.ok) return c.json({ received: true, outcome: change.error });
    await notifyStatus(deps, order.tenantId, order.orderId, status);
    return c.json({ received: true, outcome: 'applied' });
  });
}
