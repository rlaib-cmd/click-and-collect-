'use client';

import { splash360TestSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { z } from 'zod';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.payments;

export default function PaymentsPage() {
  const { auth, me } = useSession();
  // Branchement de la vraie caisse : réservé à Splash360 (audit du 25/11, M3).
  const platform = me.role === 'super_admin';
  const { data, error: loadError, reload } = useApi('/restaurants', restaurantsSchema);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});

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
    </div>
  );
}
