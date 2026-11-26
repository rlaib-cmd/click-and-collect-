'use client';

import {
  adminOrderDetailSchema,
  adminOrderSchema,
  alertsResponseSchema,
  type AdminOrder,
} from '@splash360/contracts';
import { can } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { z } from 'zod';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api, euros, toCents } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.orders;
const STATUS = messages.order.status;
const COLUMNS: { title: string; statuses: AdminOrder['status'][] }[] = [
  { title: t.new, statuses: ['paid', 'confirmed'] },
  { title: t.inProgress, statuses: ['accepted', 'preparing'] },
  { title: t.ready, statuses: ['ready', 'out_for_delivery'] },
];
const ACTIVE = COLUMNS.flatMap((c) => c.statuses).join(',');
const NEXT: Record<
  string,
  ('accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed')[]
> = {
  paid: ['accepted', 'preparing'],
  confirmed: ['accepted', 'preparing'],
  accepted: ['preparing', 'ready'],
  preparing: ['ready'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
};

const ACTORS: Record<string, string> = {
  customer: 'client',
  stripe: 'Stripe',
  pos: 'caisse',
  system: 'automatique',
};
const actor = (a: string) => ACTORS[a] ?? (a.startsWith('staff:') ? 'équipe' : a);

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

// Schémas stables (audit du 25/11, F01) : jamais recréés pendant le rendu.
const ordersListSchema = z.object({ orders: z.array(adminOrderSchema) });
const alertsSchema = alertsResponseSchema;
const ORDERS_REFRESH_MS = 15_000;
const ALERTS_REFRESH_MS = 30_000;
const DETAIL_REFRESH_MS = 10_000;

/** Tableau des commandes (rafraîchi toutes les 15 s, onglet visible). */
export default function OrdersPage() {
  const { auth } = useSession();
  // Cadences validées par l'audit du 25/11 : commandes 15 s, alertes 30 s, restaurants à l'ouverture.
  const orders = useApi(`/orders?status=${ACTIVE}`, ordersListSchema, ORDERS_REFRESH_MS);
  const alerts = useApi('/alerts', alertsSchema, ALERTS_REFRESH_MS);
  const restaurants = useApi('/restaurants', restaurantsSchema);
  const [selected, setSelected] = useState<string | null>(null);

  const togglePause = async (id: string, paused: boolean) => {
    await api(auth, `/restaurants/${id}/pause`, z.undefined(), {
      method: 'POST',
      body: { paused },
    });
    await restaurants.reload();
  };

  return (
    <div className="stack">
      <LoadError
        error={orders.error ?? alerts.error ?? restaurants.error}
        onRetry={() => {
          void orders.reload();
          void alerts.reload();
          void restaurants.reload();
        }}
      />
      <header className="row between">
        <h1>{messages.admin.nav.orders}</h1>
        <div className="row">
          {restaurants.data?.restaurants.map((r) => (
            <button
              key={r.id}
              type="button"
              className={r.status === 'paused' ? 'danger' : ''}
              onClick={() => void togglePause(r.id, r.status !== 'paused')}
            >
              {restaurants.data && restaurants.data.restaurants.length > 1 ? `${r.name} · ` : ''}
              {r.status === 'paused' ? t.resume : t.pause}
            </button>
          ))}
        </div>
      </header>

      {restaurants.data?.restaurants.some((r) => r.status === 'paused') ? (
        <p className="banner danger" role="status">
          {t.paused}
        </p>
      ) : null}
      {alerts.data && alerts.data.posToCancel.length > 0 ? (
        <div className="banner warning" role="alert">
          {t.posToCancel(alerts.data.posToCancel.map((a) => a.number))}
        </div>
      ) : null}
      {alerts.data && alerts.data.alerts.length > 0 ? (
        <div className="banner warning" role="alert">
          {t.alert(alerts.data.alerts.length)}{' '}
          {alerts.data.alerts.map((a) => (
            <button
              key={a.orderId}
              type="button"
              className="link"
              title={a.lastError ?? undefined}
              onClick={() =>
                void api(auth, `/orders/${a.orderId}/dispatch-retry`, z.undefined(), {
                  method: 'POST',
                }).then(alerts.reload)
              }
            >
              {t.retry} n° {a.number}
            </button>
          ))}
        </div>
      ) : null}

      <div className="board">
        {COLUMNS.map((col) => {
          const list = orders.data?.orders.filter((o) => col.statuses.includes(o.status)) ?? [];
          return (
            <section key={col.title} className="column" aria-label={col.title}>
              <h2>
                {col.title} <span className="badge">{list.length}</span>
              </h2>
              {list.length === 0 ? <p className="muted">{t.empty}</p> : null}
              {list.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`order-card ${selected === o.id ? 'selected' : ''}`}
                  onClick={() => setSelected(o.id)}
                >
                  <span className="row between">
                    <strong>n° {o.number}</strong>
                    <span>{t.for(time(o.estimatedAt))}</span>
                  </span>
                  <span className="row between muted">
                    <span>
                      {o.mode === 'pickup' ? t.pickup : t.delivery} · {t.items(o.itemCount)}
                    </span>
                    <span>{euros(o.totalCents)}</span>
                  </span>
                  <span>{o.customerName}</span>
                  <span className="status">{STATUS[o.status]}</span>
                  {o.paymentMethod === 'on_site' ? (
                    <span className="badge">{t.toCollect}</span>
                  ) : null}
                  {o.posPhase ? (
                    <span className={o.posPhase === 'failed' ? 'badge blocked' : 'badge'}>
                      {t.pos[o.posPhase]}
                    </span>
                  ) : null}
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {selected ? (
        <OrderDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChange={() => void orders.reload()}
        />
      ) : null}
    </div>
  );
}

function OrderDrawer({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { auth, me } = useSession();
  // Volet de détail : lu seulement pendant qu'il est ouvert.
  const detail = useApi(`/orders/${id}`, adminOrderDetailSchema, DETAIL_REFRESH_MS);
  const [refund, setRefund] = useState('');
  const [error, setError] = useState<string | null>(null);
  const o = detail.data;
  if (!o) return null;

  const act = async (status: string) => {
    if (status === 'cancelled' && !window.confirm(t.confirmCancel)) return;
    try {
      await api(auth, `/orders/${id}/status`, z.object({ status: z.string() }), {
        method: 'POST',
        body: { status },
      });
      setError(null);
      await detail.reload();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.admin.common.error);
    }
  };

  const doRefund = async () => {
    try {
      await api(auth, `/orders/${id}/refund`, z.object({ ok: z.literal(true) }).loose(), {
        method: 'POST',
        body: { amountCents: toCents(refund), requestId: crypto.randomUUID() },
      });
      setRefund('');
      await detail.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.admin.common.error);
    }
  };

  const nexts = (NEXT[o.status] ?? []).filter(
    (s) => o.mode === 'delivery' || s !== 'out_for_delivery',
  );
  const canRefund =
    can(me.role, 'orders.refund') &&
    o.refundedCents < o.totals.totalCents &&
    !['pending_payment', 'payment_failed', 'cancelled'].includes(o.status);

  return (
    <aside className="drawer" aria-label={`Commande n° ${o.number}`}>
      <header className="row between">
        <h2>Commande n° {o.number}</h2>
        <button type="button" className="link" onClick={onClose}>
          {messages.admin.common.cancel}
        </button>
      </header>
      <p className="status">{STATUS[o.status]}</p>
      <p>
        {o.mode === 'pickup' ? t.pickup : t.delivery} · {t.for(time(o.estimatedAt))}
      </p>
      <div className="row wrap">
        {nexts.map((s) => (
          <button key={s} type="button" className="primary" onClick={() => void act(s)}>
            {t.actions[s]}
          </button>
        ))}
        {!['completed', 'cancelled', 'refunded'].includes(o.status) ? (
          <button type="button" className="danger" onClick={() => void act('cancelled')}>
            {t.actions.cancelled}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <h3>{t.customer}</h3>
      <p>
        {o.customer.name} · {o.customer.phone}
        <br />
        {o.customer.email ? <span className="muted">{o.customer.email}</span> : null}
        {o.deliveryAddress ? (
          <>
            <br />
            {o.deliveryAddress.label}
          </>
        ) : null}
      </p>

      <table>
        <tbody>
          {o.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.quantity} × {l.name}
                {l.options.length ? <div className="muted">{l.options.join(', ')}</div> : null}
                {l.note ? <div className="note">« {l.note} »</div> : null}
              </td>
              <td className="num">{euros(l.totalCents)}</td>
            </tr>
          ))}
          <tr>
            <th>{t.total}</th>
            <th className="num">{euros(o.totals.totalCents)}</th>
          </tr>
        </tbody>
      </table>
      {o.refundedCents > 0 ? <p className="muted">{t.refunded(euros(o.refundedCents))}</p> : null}

      {canRefund ? (
        <div className="row wrap">
          <label className="inline">
            {t.refundAmount}
            <input
              inputMode="decimal"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              placeholder={((o.totals.totalCents - o.refundedCents) / 100).toFixed(2)}
            />
          </label>
          <button type="button" disabled={!refund} onClick={() => void doRefund()}>
            {t.refund}
          </button>
        </div>
      ) : null}

      <h3>{t.history}</h3>
      <ol className="history">
        {o.history.map((h, i) => (
          <li key={i}>
            {time(h.at)} ·{' '}
            {(STATUS as Record<string, string>)[h.status] ?? t.posEvents[h.status] ?? h.status}
            {h.note ? ` : ${h.note}` : ''} <span className="muted">({actor(h.actor)})</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
