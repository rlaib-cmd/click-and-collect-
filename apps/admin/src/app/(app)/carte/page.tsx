'use client';

import { adminMenuSchema, type AdminRestaurant } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { RestaurantPicker } from '@/components/RestaurantPicker';
import { api, euros } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.menu;

/** Carte en lecture seule : aperçu, actualisation, masquage. */
export default function MenuPage() {
  const { auth } = useSession();
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const pick = useCallback((r: AdminRestaurant) => setRestaurant(r), []);
  const menu = useApi(restaurant ? `/restaurants/${restaurant.id}/menu` : null, adminMenuSchema);
  const m = menu.data;
  const isHidden = (kind: 'category' | 'product', id: string) =>
    m?.overrides.some((o) => o.kind === kind && o.itemId === id && o.hidden) ?? false;

  const toggle = async (kind: 'category' | 'product', id: string) => {
    if (!restaurant) return;
    await api(auth, `/restaurants/${restaurant.id}/menu/overrides`, z.undefined(), {
      method: 'PUT',
      body: { overrides: [{ kind, itemId: id, hidden: !isHidden(kind, id), position: null }] },
    });
    await menu.reload();
  };

  const refresh = async () => {
    if (!restaurant) return;
    await api(auth, `/restaurants/${restaurant.id}/menu/refresh`, z.undefined(), {
      method: 'POST',
    });
    await menu.reload();
  };

  return (
    <div className="stack">
      <header className="row between">
        <h1>{messages.admin.nav.menu}</h1>
        <div className="row">
          <RestaurantPicker value={restaurant?.id ?? null} onChange={pick} />
          <button type="button" onClick={() => void refresh()}>
            {t.refresh}
          </button>
        </div>
      </header>
      <p className="muted">{t.readOnly}</p>
      {m?.stale ? <p className="banner warning">{t.stale}</p> : null}
      {m && m.warnings.length > 0 ? (
        <p className="banner warning">
          {t.warnings(new Set(m.warnings.map((w) => w.productId)).size)}
        </p>
      ) : null}
      {m?.categories.map((cat) => (
        <section key={cat.id} className={`card ${isHidden('category', cat.id) ? 'muted' : ''}`}>
          <header className="row between">
            <h2>{cat.name}</h2>
            <button type="button" className="link" onClick={() => void toggle('category', cat.id)}>
              {isHidden('category', cat.id) ? t.show : t.hide}
            </button>
          </header>
          <table>
            <tbody>
              {cat.products.map((p) => (
                <tr key={p.id} className={isHidden('product', p.id) || !p.available ? 'muted' : ''}>
                  <td>
                    {p.name}
                    {isHidden('product', p.id) ? <span className="badge">{t.hidden}</span> : null}
                    {!p.available ? (
                      <span className="badge">{messages.menu.unavailable}</span>
                    ) : null}
                  </td>
                  <td className="num">{euros(p.priceCents)}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="link"
                      onClick={() => void toggle('product', p.id)}
                    >
                      {isHidden('product', p.id) ? t.show : t.hide}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
