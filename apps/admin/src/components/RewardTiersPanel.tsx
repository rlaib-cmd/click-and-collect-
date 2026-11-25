'use client';

import { adminMenuSchema, type AdminRestaurant } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { RestaurantPicker } from './RestaurantPicker';

const t = messages.admin.rewardTiers;
const rewardsSchema = z.object({
  rewards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      costPoints: z.number().int(),
      productIds: z.array(z.string()),
      categoryIds: z.array(z.string()),
    }),
  ),
});

/**
 * Paliers du club (lot 16, ADR 0021) : l'enseigne choisit les catégories entières offertes à chaque
 * palier (ex. « toutes les boissons » à 500 points). Les catégories viennent de la carte Splash360.
 */
export function RewardTiersPanel() {
  const { auth } = useSession();
  const rewards = useApi('/loyalty/rewards', rewardsSchema);
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const pick = useCallback((r: AdminRestaurant) => setRestaurant(r), []);
  const menu = useApi(restaurant ? `/restaurants/${restaurant.id}/menu` : null, adminMenuSchema);
  const [draft, setDraft] = useState<Record<string, readonly string[]>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!rewards.data) return;
    setDraft(Object.fromEntries(rewards.data.rewards.map((r) => [r.id, r.categoryIds])));
  }, [rewards.data]);

  if (!rewards.data) return null;
  const list = rewards.data.rewards;

  const toggle = (rewardId: string, categoryId: string) => {
    setStatus(null);
    setDraft((d) => {
      const current = d[rewardId] ?? [];
      return {
        ...d,
        [rewardId]: current.includes(categoryId)
          ? current.filter((c) => c !== categoryId)
          : [...current, categoryId],
      };
    });
  };

  const save = async () => {
    try {
      await api(auth, '/loyalty/rewards', z.undefined(), {
        method: 'PUT',
        body: { rewards: list.map((r) => ({ id: r.id, categoryIds: draft[r.id] ?? [] })) },
      });
      setStatus(t.saved);
      await rewards.reload();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const categories = menu.data?.categories ?? [];
  return (
    <section className="card stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      <RestaurantPicker value={restaurant?.id ?? null} onChange={pick} />
      {list.length === 0 ? <p className="muted">{t.none}</p> : null}
      {menu.error ? <p className="muted">{t.noMenu}</p> : null}
      {list.map((r) => (
        <fieldset key={r.id} className="stack">
          <legend>
            <strong>{r.name}</strong> · {t.points(r.costPoints)}
            {r.productIds.length > 0 ? (
              <span className="muted"> · {t.listed(r.productIds.length)}</span>
            ) : null}
          </legend>
          <div className="row wrap">
            {categories.map((c) => (
              <label key={c.id} className="inline">
                <input
                  type="checkbox"
                  checked={(draft[r.id] ?? []).includes(c.id)}
                  onChange={() => toggle(r.id, c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {list.length > 0 ? (
        <div className="row">
          <button type="button" className="primary" onClick={() => void save()}>
            {t.save}
          </button>
          {status ? (
            <span role="status" className="muted">
              {status}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
