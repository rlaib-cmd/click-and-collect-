import type { StockOverride } from '@splash360/core';
import type { Sql } from './client';

/**
 * Webhooks Splash360 (lot 23, ADR 0029) : appels reçus (dédoublonnage sur `webhook-id` et journal
 * du super-administrateur) et états reçus de la caisse (disponibilité, prix de livraison propre).
 * Serveur uniquement ; aucune donnée personnelle.
 */
export type Splash360WebhookEventName = 'stock' | 'prices' | 'catalog' | 'orders';

export type WebhookReceiptOutcome =
  'received' | 'applied' | 'ignored' | 'test' | 'unknown_station' | 'unknown_order' | 'failed';

/** Résumé sans donnée personnelle : compteurs, statut, référence de ticket. */
export type WebhookSummary = Readonly<Record<string, string | number | boolean | null>>;

export interface WebhookReceipt {
  readonly webhookId: string;
  readonly event: Splash360WebhookEventName;
  readonly stationId: string;
  readonly tenantId: string | null;
  readonly restaurantId: string | null;
  readonly outcome: WebhookReceiptOutcome;
  readonly summary: WebhookSummary;
  readonly receivedAt: string;
  readonly processedAt: string | null;
}

export interface StoredStockOverride extends StockOverride {
  readonly updatedAt: Date;
}

/** Conservation des appels reçus : au moins 48 h exigées par Splash360 (§4), 7 jours ici. */
export const WEBHOOK_RECEIPT_RETENTION_MS = 7 * 24 * 3_600_000;

export interface Splash360WebhookStore {
  /**
   * Enregistre l'appel avant tout traitement ; faux si ce `webhook-id` a déjà été reçu
   * (nouvelle tentative de Splash360 : rien à refaire).
   */
  claim(input: {
    readonly webhookId: string;
    readonly event: Splash360WebhookEventName;
    readonly stationId: string;
    readonly tenantId: string | null;
    readonly restaurantId: string | null;
    readonly outcome?: WebhookReceiptOutcome;
    readonly at: Date;
  }): Promise<boolean>;
  /** Résultat du traitement (asynchrone, après la réponse 2xx). */
  finish(
    webhookId: string,
    outcome: WebhookReceiptOutcome,
    summary: WebhookSummary,
    at: Date,
  ): Promise<void>;
  /** Derniers appels reçus, du plus récent au plus ancien (100 au plus). */
  recent(limit: number): Promise<WebhookReceipt[]>;
  /** Efface les appels reçus avant `before` ; renvoie le nombre effacé. */
  purge(before: Date): Promise<number>;
  /** Disponibilités reçues (§8.1), appliquées comme des états. */
  setAvailability(
    tenantId: string,
    restaurantId: string,
    items: readonly { readonly itemId: string; readonly available: boolean }[],
    webhookId: string,
    at: Date,
  ): Promise<void>;
  /** Prix de livraison propres reçus (§8.2), en centimes. */
  setDeliveryPrices(
    tenantId: string,
    restaurantId: string,
    items: readonly { readonly itemId: string; readonly priceCents: number }[],
    webhookId: string,
    at: Date,
  ): Promise<void>;
  /**
   * Mise à jour du catalogue (§8.3) : les prix de livraison propres reçus avant `before` sont
   * effacés (le retour au prix du catalogue ne donne lieu à aucun appel, §8.2) ; les
   * disponibilités sont gardées. Renvoie le nombre de prix effacés.
   */
  clearDeliveryPrices(tenantId: string, restaurantId: string, before: Date): Promise<number>;
  /** États du restaurant (lecture de la carte : l'identifiant de restaurant est unique). */
  listOverrides(restaurantId: string): Promise<StoredStockOverride[]>;
  /** Nombre d'articles hors stock et de prix de livraison propres, par restaurant de l'enseigne. */
  countOverrides(
    tenantId: string,
  ): Promise<Record<string, { readonly unavailable: number; readonly deliveryPrices: number }>>;
}

interface ReceiptRow {
  webhook_id: string;
  event: Splash360WebhookEventName;
  station_id: string;
  tenant_id: string | null;
  restaurant_id: string | null;
  outcome: WebhookReceiptOutcome;
  summary: WebhookSummary;
  received_at: Date;
  processed_at: Date | null;
}

const toReceipt = (r: ReceiptRow): WebhookReceipt => ({
  webhookId: r.webhook_id,
  event: r.event,
  stationId: r.station_id,
  tenantId: r.tenant_id,
  restaurantId: r.restaurant_id,
  outcome: r.outcome,
  summary: r.summary,
  receivedAt: r.received_at.toISOString(),
  processedAt: r.processed_at?.toISOString() ?? null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresSplash360WebhookStore(sql: Sql): Splash360WebhookStore {
  return {
    async claim(input) {
      const rows = await sql`
        insert into splash360_private.webhook_receipts
          (webhook_id, event, station_id, tenant_id, restaurant_id, outcome, received_at)
        values (${input.webhookId}, ${input.event}, ${input.stationId}, ${input.tenantId},
                ${input.restaurantId}, ${input.outcome ?? 'received'}, ${input.at})
        on conflict (webhook_id) do nothing
        returning 1`;
      return rows.length > 0;
    },

    async finish(webhookId, outcome, summary, at) {
      await sql`
        update splash360_private.webhook_receipts
        set outcome = ${outcome}, summary = ${sql.json(summary)}, processed_at = ${at}
        where webhook_id = ${webhookId}`;
    },

    async recent(limit) {
      const rows = await sql<ReceiptRow[]>`
        select webhook_id, event, station_id, tenant_id, restaurant_id, outcome, summary,
               received_at, processed_at
        from splash360_private.webhook_receipts
        order by received_at desc, webhook_id
        limit ${Math.min(Math.max(1, limit), 100)}`;
      return rows.map(toReceipt);
    },

    async purge(before) {
      const rows = await sql`
        delete from splash360_private.webhook_receipts where received_at < ${before}`;
      return rows.count;
    },

    async setAvailability(tenantId, restaurantId, items, webhookId, at) {
      if (items.length === 0) return;
      await sql.begin(async (tx) => {
        for (const i of items) {
          await tx`
            insert into public.menu_stock_overrides
              (tenant_id, restaurant_id, item_id, available, updated_at, source_webhook_id)
            values (${tenantId}, ${restaurantId}, ${i.itemId}, ${i.available}, ${at}, ${webhookId})
            on conflict (restaurant_id, item_id) do update
              set available = excluded.available, updated_at = excluded.updated_at,
                  source_webhook_id = excluded.source_webhook_id
              where menu_stock_overrides.tenant_id = excluded.tenant_id`;
        }
      });
    },

    async setDeliveryPrices(tenantId, restaurantId, items, webhookId, at) {
      if (items.length === 0) return;
      await sql.begin(async (tx) => {
        for (const i of items) {
          await tx`
            insert into public.menu_stock_overrides
              (tenant_id, restaurant_id, item_id, delivery_price_cents, updated_at, source_webhook_id)
            values (${tenantId}, ${restaurantId}, ${i.itemId}, ${i.priceCents}, ${at}, ${webhookId})
            on conflict (restaurant_id, item_id) do update
              set delivery_price_cents = excluded.delivery_price_cents,
                  updated_at = excluded.updated_at, source_webhook_id = excluded.source_webhook_id
              where menu_stock_overrides.tenant_id = excluded.tenant_id`;
        }
      });
    },

    async clearDeliveryPrices(tenantId, restaurantId, before) {
      return sql.begin(async (tx) => {
        const cleared = await tx`
          update public.menu_stock_overrides set delivery_price_cents = null
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}
            and delivery_price_cents is not null and updated_at < ${before}`;
        await tx`
          delete from public.menu_stock_overrides
          where tenant_id = ${tenantId} and restaurant_id = ${restaurantId}
            and available is null and delivery_price_cents is null`;
        return cleared.count;
      });
    },

    async listOverrides(restaurantId) {
      if (!UUID.test(restaurantId)) return [];
      const rows = await sql<
        {
          item_id: string;
          available: boolean | null;
          delivery_price_cents: number | null;
          updated_at: Date;
        }[]
      >`
        select item_id, available, delivery_price_cents, updated_at
        from public.menu_stock_overrides where restaurant_id = ${restaurantId}`;
      return rows.map((r) => ({
        itemId: r.item_id,
        available: r.available,
        deliveryPriceCents: r.delivery_price_cents,
        updatedAt: r.updated_at,
      }));
    },

    async countOverrides(tenantId) {
      const rows = await sql<{ restaurant_id: string; unavailable: number; prices: number }[]>`
        select restaurant_id,
               count(*) filter (where available = false)::int as unavailable,
               count(*) filter (where delivery_price_cents is not null)::int as prices
        from public.menu_stock_overrides where tenant_id = ${tenantId}
        group by restaurant_id`;
      return Object.fromEntries(
        rows.map((r) => [
          r.restaurant_id,
          { unavailable: r.unavailable, deliveryPrices: r.prices },
        ]),
      );
    },
  };
}

/** Implémentation en mémoire (tests), mêmes règles que Postgres. */
export function createMemorySplash360WebhookStore(): Splash360WebhookStore & {
  readonly receipts: WebhookReceipt[];
} {
  const receipts: WebhookReceipt[] = [];
  const overrides = new Map<string, StoredStockOverride & { tenantId: string }>();
  const key = (restaurantId: string, itemId: string) => `${restaurantId}/${itemId}`;
  const upsert = (
    tenantId: string,
    restaurantId: string,
    itemId: string,
    change: Partial<StockOverride>,
    at: Date,
  ) => {
    const k = key(restaurantId, itemId);
    const previous = overrides.get(k);
    if (previous && previous.tenantId !== tenantId) return;
    overrides.set(k, {
      tenantId,
      itemId,
      available: previous?.available ?? null,
      deliveryPriceCents: previous?.deliveryPriceCents ?? null,
      ...change,
      updatedAt: at,
    });
  };
  return {
    receipts,
    claim(input) {
      if (receipts.some((r) => r.webhookId === input.webhookId)) return Promise.resolve(false);
      receipts.push({
        webhookId: input.webhookId,
        event: input.event,
        stationId: input.stationId,
        tenantId: input.tenantId,
        restaurantId: input.restaurantId,
        outcome: input.outcome ?? 'received',
        summary: {},
        receivedAt: input.at.toISOString(),
        processedAt: null,
      });
      return Promise.resolve(true);
    },
    finish(webhookId, outcome, summary, at) {
      const i = receipts.findIndex((r) => r.webhookId === webhookId);
      const r = receipts[i];
      if (r) receipts[i] = { ...r, outcome, summary, processedAt: at.toISOString() };
      return Promise.resolve();
    },
    recent(limit) {
      return Promise.resolve(
        [...receipts]
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          .slice(0, Math.min(Math.max(1, limit), 100)),
      );
    },
    purge(before) {
      const kept = receipts.filter((r) => new Date(r.receivedAt) >= before);
      const removed = receipts.length - kept.length;
      receipts.splice(0, receipts.length, ...kept);
      return Promise.resolve(removed);
    },
    setAvailability(tenantId, restaurantId, items, _webhookId, at) {
      for (const i of items)
        upsert(tenantId, restaurantId, i.itemId, { available: i.available }, at);
      return Promise.resolve();
    },
    setDeliveryPrices(tenantId, restaurantId, items, _webhookId, at) {
      for (const i of items)
        upsert(tenantId, restaurantId, i.itemId, { deliveryPriceCents: i.priceCents }, at);
      return Promise.resolve();
    },
    clearDeliveryPrices(tenantId, restaurantId, before) {
      let cleared = 0;
      for (const [k, o] of overrides) {
        if (!k.startsWith(`${restaurantId}/`) || o.tenantId !== tenantId) continue;
        if (o.deliveryPriceCents === null || o.updatedAt >= before) continue;
        cleared += 1;
        if (o.available === null) overrides.delete(k);
        else overrides.set(k, { ...o, deliveryPriceCents: null });
      }
      return Promise.resolve(cleared);
    },
    listOverrides(restaurantId) {
      return Promise.resolve(
        [...overrides.entries()]
          .filter(([k]) => k.startsWith(`${restaurantId}/`))
          .map(([, { tenantId: _t, ...o }]) => o),
      );
    },
    countOverrides(tenantId) {
      const out: Record<string, { unavailable: number; deliveryPrices: number }> = {};
      for (const [k, o] of overrides) {
        if (o.tenantId !== tenantId) continue;
        const restaurantId = k.slice(0, k.indexOf('/'));
        const c = (out[restaurantId] ??= { unavailable: 0, deliveryPrices: 0 });
        if (o.available === false) c.unavailable += 1;
        if (o.deliveryPriceCents !== null) c.deliveryPrices += 1;
      }
      return Promise.resolve(out);
    },
  };
}
