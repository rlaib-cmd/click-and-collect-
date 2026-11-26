import {
  isSplash360WebhookEvent,
  parseWebhookPayload,
  verifyWebhookSignature,
  webhookChallenge,
  type WebhookKey,
} from '@splash360/api-menu';
import {
  SPLASH360_STATION_ID,
  type RestaurantStore,
  type Splash360WebhookStore,
} from '@splash360/db';
import { Hono } from 'hono';
import { apiError } from '../errors';
import type { WebhookJob, WebhookResult } from '../splash360/webhooks';

export interface Splash360WebhookRouteDeps {
  /** Clés de `SPLASH360_WEBHOOK_SECRETS` ; vide : réception désactivée (503). */
  readonly keys: readonly WebhookKey[];
  readonly restaurants: RestaurantStore;
  readonly store: Splash360WebhookStore;
  readonly process: (job: WebhookJob) => Promise<WebhookResult>;
  /** Tâche de fond : la réponse part avant la fin du traitement (§2 : 10 s au plus). */
  readonly background: (name: string, task: Promise<unknown>) => void;
  readonly now: () => Date;
  readonly log: (message: string, detail?: Record<string, unknown>) => void;
}

/** Début de l'identifiant de station, seul écrit au journal. */
const stationHint = (stationId: string) => `${stationId.slice(0, 4)}…`;

/**
 * Webhooks Splash360 (lot 23, ADR 0029) : `POST /v1/webhooks/splash360/:event/:stationId`, un
 * événement par URL déclarée (stock, prices, catalog, orders), la station en dernier segment.
 * Signature vérifiée sur les octets reçus ; 401 sans motif ; réponse 2xx tout de suite (station
 * inconnue comprise, pour que Splash360 ne désactive pas l'URL), traitement en tâche de fond.
 * Jamais de 410 : il désactiverait l'URL chez Splash360.
 */
export function splash360WebhookRoutes(deps: Splash360WebhookRouteDeps) {
  return new Hono().post('/:event/:stationId', async (c) => {
    const event = c.req.param('event');
    if (!isSplash360WebhookEvent(event)) return apiError(c, 'not_found', 'Route inconnue');
    if (deps.keys.length === 0) return c.body(null, 503);
    // Corps brut, avant tout décodage JSON : la signature porte sur ces octets.
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const webhookId = c.req.header('webhook-id');
    const now = deps.now();
    if (
      !verifyWebhookSignature({
        keys: deps.keys,
        id: webhookId,
        timestamp: c.req.header('webhook-timestamp'),
        signature: c.req.header('webhook-signature'),
        body: raw,
        now,
      }) ||
      !webhookId
    ) {
      return c.body(null, 401);
    }
    if (webhookId.length > 200) return c.body(null, 400);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return c.body(null, 400);
    }
    // Vérification de l'URL (§5) : la même valeur, rien d'autre.
    const challenge = webhookChallenge(body);
    if (challenge) return c.json(challenge);

    const stationId = c.req.param('stationId');
    const restaurant = SPLASH360_STATION_ID.test(stationId)
      ? await deps.restaurants.findBySplash360Station(stationId)
      : null;
    const fresh = await deps.store.claim({
      webhookId,
      event,
      stationId: stationId.slice(0, 200),
      tenantId: restaurant?.tenantId ?? null,
      restaurantId: restaurant?.id ?? null,
      outcome: restaurant ? 'received' : 'unknown_station',
      at: now,
    });
    // Nouvelle tentative d'un appel déjà reçu (même webhook-id, §4) : rien à refaire.
    if (!fresh) return c.json({ received: true });
    if (!restaurant) {
      deps.log('Webhook Splash360 : station inconnue, à rattacher au back-office', {
        event,
        station: stationHint(stationId),
      });
      return c.json({ received: true });
    }
    const payload = parseWebhookPayload(event, body);
    if (!payload) {
      deps.log('Webhook Splash360 : corps illisible', { event, station: stationHint(stationId) });
      await deps.store.finish(webhookId, 'failed', { error: 'invalid_body' }, now);
      return c.json({ received: true });
    }
    deps.background(
      `splash360-${event}`,
      deps
        .process({ webhookId, restaurant, payload, receivedAt: now })
        .catch((error: unknown) => {
          deps.log('Webhook Splash360 : traitement en échec', {
            event,
            error: error instanceof Error ? error.message : String(error),
          });
          return { outcome: 'failed' as const, summary: { error: 'processing_failed' } };
        })
        .then((result) => deps.store.finish(webhookId, result.outcome, result.summary, deps.now())),
    );
    return c.json({ received: true });
  });
}
