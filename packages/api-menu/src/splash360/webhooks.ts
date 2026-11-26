import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { eurosToCents } from './sales';

/**
 * Webhooks Splash360 (lot 23, ADR 0029, `docs/api-splash360/webhooks.md`) : signature Standard
 * Webhooks et traduction des corps (snake_case, champs inconnus ignorés) vers des types internes.
 * Ce module ne fait aucun appel réseau : il lit ce que Splash360 envoie.
 */

/** Les quatre événements, un par URL déclarée chez Splash360 (§1). */
export const SPLASH360_WEBHOOK_EVENTS = ['stock', 'prices', 'catalog', 'orders'] as const;
export type Splash360WebhookEvent = (typeof SPLASH360_WEBHOOK_EVENTS)[number];

export function isSplash360WebhookEvent(value: string): value is Splash360WebhookEvent {
  return (SPLASH360_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Écart maximal entre `webhook-timestamp` et notre horloge (§3 : 5 minutes). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Clé de signature : la partie après `whsec_`, décodée de base64 (§3). */
export type WebhookKey = Uint8Array;

/**
 * Secrets de `SPLASH360_WEBHOOK_SECRETS` (séparés par des virgules : un par URL, plus l'ancien
 * pendant un changement de secret, §7). Lève une erreur sans jamais citer la valeur.
 */
export function parseWebhookSecrets(raw: string | undefined): WebhookKey[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((secret, index) => {
      const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : '';
      const key = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        ? new Uint8Array(Buffer.from(encoded, 'base64'))
        : new Uint8Array(0);
      if (key.length < 16) {
        throw new Error(
          `SPLASH360_WEBHOOK_SECRETS : secret n° ${index + 1} illisible (attendu « whsec_ » suivi de base64)`,
        );
      }
      return key;
    });
}

export interface WebhookSignatureInput {
  readonly keys: readonly WebhookKey[];
  readonly id: string | undefined;
  readonly timestamp: string | undefined;
  /** En-tête `webhook-signature` : `v1,<base64>`, plusieurs séparées par des espaces. */
  readonly signature: string | undefined;
  /** Corps brut, octets reçus tels quels (jamais re-sérialisé). */
  readonly body: Uint8Array;
  readonly now: Date;
}

/**
 * Vérification Standard Webhooks (§3) : HMAC-SHA256 de `id.timestamp.corps`, comparé en temps
 * constant à chaque valeur `v1,…` ; horodatage à ± 5 minutes. Vrai si une clé et une signature
 * correspondent.
 */
export function verifyWebhookSignature(input: WebhookSignatureInput): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || input.keys.length === 0) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (Math.abs(input.now.getTime() / 1000 - seconds) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const received = signature
    .split(' ')
    .filter((s) => s.startsWith('v1,'))
    // Comparaison des textes base64 (comme les exemples PHP et Python du guide) : un décodage
    // tolérant accepterait des variantes de la même signature.
    .map((s) => Buffer.from(s.slice(3), 'utf8'));
  if (received.length === 0) return false;
  const prefix = Buffer.from(`${id}.${timestamp}.`, 'utf8');
  let valid = false;
  for (const key of input.keys) {
    const expected = Buffer.from(
      createHmac('sha256', key).update(prefix).update(input.body).digest('base64'),
      'utf8',
    );
    for (const r of received) {
      // Pas de sortie anticipée : même travail quelle que soit la signature qui correspond.
      if (r.length === expected.length && timingSafeEqual(r, expected)) valid = true;
    }
  }
  return valid;
}

/** Signature d'un corps (tests et outils de recette ; jamais de secret dans le dépôt). */
export function signWebhook(key: WebhookKey, id: string, timestamp: number, body: string): string {
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`, 'utf8')
    .update(body, 'utf8')
    .digest('base64');
  return `v1,${digest}`;
}

/** Challenge de vérification de l'URL (§5) : un objet qui contient la clé `challenge`. */
export function webhookChallenge(body: unknown): { readonly challenge: unknown } | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!Object.prototype.hasOwnProperty.call(body, 'challenge')) return null;
  return { challenge: (body as { challenge: unknown }).challenge };
}

/** Identifiant d'article publié (§8.1) : `prd…`, `ing…-typ…` ou SKU. */
const itemId = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)))
  .transform((s) => new Date(s));

/** Élément illisible : ignoré, compté à part (les autres éléments restent appliqués). */
const stockItem = z
  .object({ item_id: itemId, status: z.enum(['available', 'unavailable']) })
  .transform((i) => ({ itemId: i.item_id, available: i.status === 'available' }))
  .nullable()
  .catch(null);
const priceItem = z
  .object({ item_id: itemId, price: z.number().finite().min(0).max(10_000) })
  .transform((i) => ({ itemId: i.item_id, priceCents: eurosToCents(i.price) }))
  .nullable()
  .catch(null);
const catalogBody = z.object({
  catalog_id: z.union([z.number(), z.string()]).transform(String),
  revision: z.union([z.number(), z.string()]).transform(String).optional(),
  installed_at: isoDate.nullable().optional().catch(null),
});
const orderBody = z.object({
  order_id: z.string().min(1).max(100),
  status: z.enum(['paid', 'cancelled']),
  amount: z.number().finite().min(0).nullable().optional().catch(null),
  occurred_at: isoDate.nullable().optional().catch(null),
  reason: z.string().max(500).nullable().optional().catch(null),
});

export interface StockState {
  readonly itemId: string;
  readonly available: boolean;
}
export interface DeliveryPriceState {
  readonly itemId: string;
  readonly priceCents: number;
}

export type Splash360WebhookPayload =
  | {
      readonly event: 'stock';
      readonly items: readonly StockState[];
      readonly skipped: number;
    }
  | {
      readonly event: 'prices';
      readonly items: readonly DeliveryPriceState[];
      readonly skipped: number;
    }
  | {
      readonly event: 'catalog';
      readonly catalogId: string;
      readonly revision: string | null;
      readonly installedAt: Date | null;
      /** Appel de test (§8.5) : `catalog_id` 0. */
      readonly test: boolean;
    }
  | {
      readonly event: 'orders';
      /** Référence Splash360 de la commande : le ticket reçu au dépôt (`pos_ticket_id`). */
      readonly ticketId: string;
      readonly status: 'paid' | 'cancelled';
      readonly amountCents: number | null;
      readonly occurredAt: Date | null;
      readonly reason: string | null;
      /** Appel de test (§8.5) : `order_id` commençant par `TEST-`. */
      readonly test: boolean;
    };

/** Corps d'un événement → type interne ; null s'il est illisible. Champs inconnus ignorés (§8). */
export function parseWebhookPayload(
  event: Splash360WebhookEvent,
  body: unknown,
): Splash360WebhookPayload | null {
  switch (event) {
    case 'stock': {
      if (!Array.isArray(body)) return null;
      const items = body.map((b) => stockItem.parse(b));
      const kept = items.filter((i): i is StockState => i !== null);
      return { event, items: kept, skipped: items.length - kept.length };
    }
    case 'prices': {
      if (!Array.isArray(body)) return null;
      const items = body.map((b) => priceItem.parse(b));
      const kept = items.filter((i): i is DeliveryPriceState => i !== null);
      return { event, items: kept, skipped: items.length - kept.length };
    }
    case 'catalog': {
      const parsed = catalogBody.safeParse(body);
      if (!parsed.success) return null;
      const d = parsed.data;
      return {
        event,
        catalogId: d.catalog_id,
        revision: d.revision ?? null,
        installedAt: d.installed_at ?? null,
        test: d.catalog_id === '0',
      };
    }
    case 'orders': {
      const parsed = orderBody.safeParse(body);
      if (!parsed.success) return null;
      const d = parsed.data;
      return {
        event,
        ticketId: d.order_id,
        status: d.status,
        amountCents: d.amount === null || d.amount === undefined ? null : eurosToCents(d.amount),
        occurredAt: d.occurred_at ?? null,
        reason: d.reason?.trim() || null,
        test: d.order_id.startsWith('TEST-'),
      };
    }
  }
}
