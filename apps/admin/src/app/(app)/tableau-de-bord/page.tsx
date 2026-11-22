'use client';

import { dashboardSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { euros } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const t = messages.admin.dashboard;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function DashboardPage() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 86_400_000)));
  const [to, setTo] = useState(iso(today));
  const { data } = useApi(`/dashboard?from=${from}&to=${to}`, dashboardSchema);
  const max = Math.max(1, ...(data?.byDay.map((d) => d.revenueCents) ?? []));

  return (
    <div className="stack">
      <header className="row between">
        <h1>{messages.admin.nav.dashboard}</h1>
        <div className="row">
          <label className="inline">
            {t.from}{' '}
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline">
            {t.to}{' '}
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </header>
      {data ? (
        <>
          <div className="kpis">
            <div className="card kpi">
              <span className="muted">{t.revenue}</span>
              <strong>{euros(data.revenueCents)}</strong>
            </div>
            <div className="card kpi">
              <span className="muted">{t.orders}</span>
              <strong>{data.orders}</strong>
            </div>
            <div className="card kpi">
              <span className="muted">{t.basket}</span>
              <strong>{euros(data.averageBasketCents)}</strong>
            </div>
            <div className="card kpi">
              <span className="muted">{t.split}</span>
              <strong>
                {data.byMode.pickup} / {data.byMode.delivery}
              </strong>
            </div>
          </div>
          <section className="card">
            <h2>{t.byDay}</h2>
            {data.byDay.length === 0 ? <p className="muted">{messages.admin.common.none}</p> : null}
            <ul className="bars">
              {data.byDay.map((d) => (
                <li key={d.day}>
                  <span className="bar-label">
                    {new Date(`${d.day}T12:00:00Z`).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="bar" style={{ width: `${(d.revenueCents / max) * 100}%` }} />
                  <span className="bar-value">
                    {euros(d.revenueCents)} · {d.orders}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>{t.byRestaurant}</h2>
            <table>
              <tbody>
                {data.byRestaurant.map((r) => (
                  <tr key={r.restaurantId}>
                    <td>{r.name}</td>
                    <td className="num">{r.orders}</td>
                    <td className="num">{euros(r.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  );
}
