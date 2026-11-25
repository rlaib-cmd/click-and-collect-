'use client';

import { adminMenuSchema, type AdminRestaurant } from '@splash360/contracts';
import { can } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { RestaurantPicker } from '@/components/RestaurantPicker';
import { api, euros } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.menu;

/** Carte en lecture seule : aperçu, actualisation, masquage. */
export default function MenuPage() {
  const { auth, me } = useSession();
  const [restaurant, setRestaurant] = useState<AdminRestaurant | null>(null);
  const pick = useCallback((r: AdminRestaurant) => setRestaurant(r), []);
  const menu = useApi(restaurant ? `/restaurants/${restaurant.id}/menu` : null, adminMenuSchema);
  const m = menu.data;
  const isHidden = (kind: 'category' | 'product', id: string) =>
    m?.overrides.some((o) => o.kind === kind && o.itemId === id && o.hidden) ?? false;

  const isFeatured = (id: string) =>
    m?.overrides.some((o) => o.kind === 'product' && o.itemId === id && o.featured === true) ??
    false;

  const toggleFeatured = async (id: string) => {
    if (!restaurant) return;
    const current = m?.overrides.find((o) => o.kind === 'product' && o.itemId === id);
    await api(auth, `/restaurants/${restaurant.id}/menu/overrides`, z.undefined(), {
      method: 'PUT',
      body: {
        overrides: [
          {
            kind: 'product',
            itemId: id,
            hidden: current?.hidden ?? false,
            position: current?.position ?? null,
            featured: !isFeatured(id),
          },
        ],
      },
    });
    await menu.reload();
  };

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
      <LoadError error={menu.error} onRetry={() => void menu.reload()} />
      <header className="row between">
        <h1>{messages.admin.nav.menu}</h1>
        <div className="row">
          <RestaurantPicker value={restaurant?.id ?? null} onChange={pick} />
          {can(me.role, 'menu.manage') ? (
            <button type="button" onClick={() => void refresh()}>
              {t.refresh}
            </button>
          ) : null}
        </div>
      </header>
      <p className="muted">{t.readOnly}</p>
      <p className="muted">{t.featuredHint}</p>
      {m?.stale ? <p className="banner warning">{t.stale}</p> : null}
      {m && m.warnings.length > 0 ? (
        <p className="banner warning">
          {t.warnings(new Set(m.warnings.map((w) => w.productId)).size)}
        </p>
      ) : null}
      {m?.categories.map((cat) => (
        <section
          key={cat.id}
          className={`card stack ${isHidden('category', cat.id) ? 'muted' : ''}`}
          style={{ gap: 8 }}
        >
          <header className="row between">
            <h2 style={{ margin: 0 }}>{cat.name}</h2>
            <button type="button" className="link" onClick={() => void toggle('category', cat.id)}>
              {isHidden('category', cat.id) ? t.show : t.hide}
            </button>
          </header>
          <table>
            <tbody>
              {cat.products.map((p) => (
                <tr
                  key={p.id}
                  data-testid={`product-${p.id}`}
                  className={isHidden('product', p.id) || !p.available ? 'muted' : ''}
                >
                  <td style={{ width: 64 }}>
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        width={48}
                        height={48}
                        style={{ objectFit: 'contain', borderRadius: 10, background: '#fff' }}
                      />
                    ) : null}
                  </td>
                  <td>
                    <strong>{p.name}</strong>
                    {isHidden('product', p.id) ? (
                      <span className="badge warn">{t.paused}</span>
                    ) : null}
                    {!p.available ? (
                      <span className="badge">{messages.menu.unavailable}</span>
                    ) : null}
                    {isFeatured(p.id) ? <span className="badge ok">★ {t.featured}</span> : null}
                  </td>
                  <td className="num">{euros(p.priceCents)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      aria-pressed={isFeatured(p.id)}
                      aria-label={
                        isFeatured(p.id) ? t.unfeatureLabel(p.name) : t.featureLabel(p.name)
                      }
                      onClick={() => void toggleFeatured(p.id)}
                      style={{ marginRight: 8 }}
                    >
                      {isFeatured(p.id) ? t.unfeature : t.feature}
                    </button>
                    <button
                      type="button"
                      aria-label={`${isHidden('product', p.id) ? t.resume : t.pause} : ${p.name}`}
                      onClick={() => void toggle('product', p.id)}
                    >
                      {isHidden('product', p.id) ? t.resume : t.pause}
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
