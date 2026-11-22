import type { Menu } from '@splash360/core';
import { MenuUnavailableError, type MenuProvider, type MenuSource } from './provider';

export interface CachedMenu {
  readonly menu: Menu;
  readonly fetchedAt: Date;
  /** Vrai si l'API menu n'a pas répondu et que la dernière carte connue est servie. */
  readonly stale: boolean;
}

export interface MenuCacheOptions {
  /** Durée de fraîcheur, en millisecondes (« quelques minutes »). */
  readonly ttlMs: number;
  /** Âge maximal d'une carte servie quand l'API menu est en panne. Au-delà : commande bloquée. */
  readonly maxStaleMs: number;
  readonly now?: () => Date;
}

export interface MenuCache {
  get(source: MenuSource): Promise<CachedMenu>;
  /** Bouton « Actualiser » du back-office, ou notification de changement de l'API menu. */
  invalidate(restaurantId: string): void;
}

/**
 * Cache de carte par restaurant (section 7) : rafraîchi après `ttlMs` ;
 * si l'API menu ne répond pas, la dernière carte connue est servie tant qu'elle a moins de `maxStaleMs`.
 */
export function createMenuCache(provider: MenuProvider, options: MenuCacheOptions): MenuCache {
  const now = options.now ?? (() => new Date());
  const entries = new Map<string, { menu: Menu; fetchedAt: Date; expired: boolean }>();
  const inflight = new Map<string, Promise<CachedMenu>>();

  async function refresh(source: MenuSource): Promise<CachedMenu> {
    const previous = entries.get(source.restaurantId);
    try {
      const menu = await provider.fetchMenu(source);
      const fetchedAt = now();
      entries.set(source.restaurantId, { menu, fetchedAt, expired: false });
      return { menu, fetchedAt, stale: false };
    } catch (error) {
      if (previous && now().getTime() - previous.fetchedAt.getTime() <= options.maxStaleMs) {
        return { menu: previous.menu, fetchedAt: previous.fetchedAt, stale: true };
      }
      throw new MenuUnavailableError('Carte indisponible', error);
    }
  }

  return {
    async get(source) {
      const entry = entries.get(source.restaurantId);
      if (entry && !entry.expired && now().getTime() - entry.fetchedAt.getTime() < options.ttlMs) {
        return { menu: entry.menu, fetchedAt: entry.fetchedAt, stale: false };
      }
      // Une seule requête à la fois par restaurant, même sous forte charge.
      const pending = inflight.get(source.restaurantId);
      if (pending) return pending;
      const promise = refresh(source).finally(() => inflight.delete(source.restaurantId));
      inflight.set(source.restaurantId, promise);
      return promise;
    },
    invalidate(restaurantId) {
      const entry = entries.get(restaurantId);
      if (entry) entry.expired = true;
    },
  };
}
