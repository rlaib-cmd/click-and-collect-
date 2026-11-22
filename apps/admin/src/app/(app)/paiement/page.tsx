'use client';

import { messages } from '@splash360/i18n';
import { useState } from 'react';
import { z } from 'zod';
import { restaurantsSchema } from '@/components/RestaurantPicker';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.payments;

export default function PaymentsPage() {
  const { auth } = useSession();
  const { data } = useApi('/restaurants', restaurantsSchema);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="stack">
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
    </div>
  );
}
