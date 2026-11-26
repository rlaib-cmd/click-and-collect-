'use client';

import { splash360TestSchema, splash360WebhookLogSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { z } from 'zod';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.payments;
const w = t.webhooks;

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Paris',
  });

/** Résumé d'un appel reçu : compteurs et statut, sans donnée personnelle. */
const summaryText = (summary: Record<string, string | number | boolean | null>) =>
  Object.entries(summary)
    .map(([k, v]) => `${w.summary[k] ?? k} : ${String(v)}`)
    .join(' · ');

export default function PaymentsPage() {
  const { auth, me } = useSession();
  // Branchement de la vraie caisse : réservé à Splash360 (audit du 25/11, M3).
  const platform = me.role === 'super_admin';
  const { data, error: loadError, reload } = useApi('/restaurants', restaurantsSchema);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [stations, setStations] = useState<Record<string, string>>({});
  // Journal des webhooks Splash360 (lot 23) : super-administrateur seulement.
  const webhooks = useApi(platform ? '/splash360/webhooks' : null, splash360WebhookLogSchema);

  const saveStation = async (id: string) => {
    const value = (stations[id] ?? '').trim();
    try {
      await api(auth, `/restaurants/${id}/splash360/station`, z.undefined(), {
        method: 'PUT',
        body: { stationId: value === '' ? null : value },
      });
      setStations((s) => {
        const { [id]: _done, ...rest } = s;
        return rest;
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.admin.common.error);
    }
  };

  const onboard = async (id: string) => {
    try {
      const { url } = await api(
        auth,
        `/restaurants/${id}/stripe/onboarding`,
        z.object({ url: z.url() }),
        { method: 'POST' },
      );
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.admin.common.error);
    }
  };

  const setLive = async (id: string, live: boolean) => {
    if (live && !window.confirm(t.pos.confirmConnect)) return;
    try {
      await api(auth, `/restaurants/${id}/splash360`, z.undefined(), {
        method: 'POST',
        body: { live },
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.admin.common.error);
    }
  };

  const test = async (id: string) => {
    setTests((s) => ({ ...s, [id]: t.pos.testing }));
    try {
      const r = await api(auth, `/restaurants/${id}/splash360/test`, splash360TestSchema, {
        method: 'POST',
      });
      setTests((s) => ({
        ...s,
        [id]: r.ok ? t.pos.testOk(r.products, r.categories) : t.pos.testFailed(r.message),
      }));
    } catch (e) {
      setTests((s) => ({
        ...s,
        [id]: e instanceof Error ? e.message : messages.admin.common.error,
      }));
    }
  };

  return (
    <div className="stack">
      <LoadError error={loadError} onRetry={() => void reload()} />
      <h1>{messages.admin.nav.payments}</h1>
      <p className="muted">{t.help}</p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{messages.admin.common.restaurant}</th>
            <th>{t.status}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.restaurants.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                {r.stripeChargesEnabled ? t.enabled : r.stripeAccountId ? t.pending : t.missing}
              </td>
              <td>
                {r.stripeChargesEnabled ? null : (
                  <button type="button" className="primary" onClick={() => void onboard(r.id)}>
                    {t.onboard}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t.pos.title}</h2>
      <p className="muted">{t.pos.help}</p>
      {data && !data.splash360Configured ? (
        <p className="banner info" role="status">
          {t.pos.notConfigured}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{messages.admin.common.restaurant}</th>
            <th>{t.pos.status}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.restaurants.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                <span className={r.splash360Live ? 'pill success' : 'pill'}>
                  {r.splash360Live ? t.pos.live : t.pos.demo}
                </span>
                {tests[r.id] ? (
                  <p className="muted" role="status" style={{ margin: '6px 0 0' }}>
                    {tests[r.id]}
                  </p>
                ) : null}
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  {w.station} : {r.splash360StationId ?? w.stationNone}
                  {' · '}
                  {w.stock(r.stock.unavailable, r.stock.deliveryPrices)}
                </p>
                {platform ? (
                  <form
                    className="row"
                    style={{ gap: 8, marginTop: 6 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveStation(r.id);
                    }}
                  >
                    <input
                      aria-label={w.station}
                      title={w.stationHelp}
                      placeholder={w.stationPlaceholder}
                      value={stations[r.id] ?? r.splash360StationId ?? ''}
                      onChange={(e) => setStations((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <button type="submit">{messages.admin.common.save}</button>
                  </form>
                ) : null}
              </td>
              <td className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={!data.splash360Configured}
                  onClick={() => void test(r.id)}
                >
                  {t.pos.test}
                </button>
                {!platform ? null : r.splash360Live ? (
                  <button type="button" onClick={() => void setLive(r.id, false)}>
                    {t.pos.disconnect}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    disabled={!data.splash360Configured}
                    onClick={() => void setLive(r.id, true)}
                  >
                    {t.pos.connect}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {platform ? (
        <>
          <h2>{w.title}</h2>
          <p className="muted">{w.help}</p>
          <LoadError error={webhooks.error} onRetry={() => void webhooks.reload()} />
          {webhooks.data && !webhooks.data.configured ? (
            <p className="banner info" role="status">
              {w.notConfigured}
            </p>
          ) : null}
          {webhooks.data && webhooks.data.receipts.length === 0 ? (
            <p className="muted">{messages.admin.common.none}</p>
          ) : null}
          {webhooks.data && webhooks.data.receipts.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>{w.receivedAt}</th>
                  <th>{w.event}</th>
                  <th>{w.station}</th>
                  <th>{w.outcome}</th>
                  <th>{w.detail}</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.data.receipts.map((r) => (
                  <tr key={r.webhookId}>
                    <td>{dateTime(r.receivedAt)}</td>
                    <td>{w.events[r.event]}</td>
                    <td>
                      <code>{r.stationId}</code>
                      {r.restaurantId
                        ? ` · ${data?.restaurants.find((x) => x.id === r.restaurantId)?.name ?? ''}`
                        : ''}
                    </td>
                    <td>
                      <span
                        className={
                          r.outcome === 'applied'
                            ? 'pill success'
                            : r.outcome === 'failed' || r.outcome === 'unknown_station'
                              ? 'pill danger'
                              : 'pill'
                        }
                      >
                        {w.outcomes[r.outcome]}
                      </span>
                    </td>
                    <td className="muted">{summaryText(r.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
