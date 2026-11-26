import type { MenuCache } from '@splash360/api-menu';
import { applyStockOverrides, type StockOverride } from '@splash360/core';
import type { Splash360WebhookStore } from '@splash360/db';

/** Durée pendant laquelle une instance garde les états de la caisse sans les relire. */
export const STOCK_TTL_MS = 5_000;

/**
 * Cache de carte complété des états reçus de la caisse (webhooks Splash360, lot 23, ADR 0029) :
 * disponibilité et prix de livraison propre appliqués à chaque lecture, donc à la carte servie,
 * à l'aperçu du back-office et au calcul serveur du prix. Les états sont relus au plus toutes les
 * `ttlMs` (autres instances), et tout de suite sur l'instance qui reçoit le webhook.
 */
export function createStockMenuCache(
  inner: MenuCache,
  store: Pick<Splash360WebhookStore, 'listOverrides'>,
  options: { readonly ttlMs?: number; readonly now?: (() => Date) | undefined } = {},
): MenuCache & { refreshStock(restaurantId: string): void } {
  const ttl = options.ttlMs ?? STOCK_TTL_MS;
  const now = options.now ?? (() => new Date());
  const states = new Map<string, { at: number; overrides: Promise<readonly StockOverride[]> }>();

  const overridesOf = (restaurantId: string) => {
    const entry = states.get(restaurantId);
    const t = now().getTime();
    if (entry && t - entry.at < ttl) return entry.overrides;
    const overrides = store.listOverrides(restaurantId);
    states.set(restaurantId, { at: t, overrides });
    // Échec de lecture : pas gardé, la lecture suivante réessaie.
    void overrides.catch(() => states.delete(restaurantId));
    return overrides;
  };

  return {
    async get(source) {
      const [cached, overrides] = await Promise.all([
        inner.get(source),
        overridesOf(source.restaurantId),
      ]);
      return { ...cached, menu: applyStockOverrides(cached.menu, overrides) };
    },
    invalidate(restaurantId) {
      inner.invalidate(restaurantId);
      states.delete(restaurantId);
    },
    refreshStock(restaurantId) {
      states.delete(restaurantId);
    },
  };
}
