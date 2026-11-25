'use client';

import {
  loyaltyOperationSchema,
  loyaltySettingsResponseSchema,
  type LoyaltySettingsResponse,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const ts = messages.admin.loyaltySettings;
const to = messages.admin.loyaltyOperations;
const operationsSchema = z.object({ operations: z.array(loyaltyOperationSchema) });

/** Réglages du programme YouFID (lot 21) : points par euro et points de bienvenue. */
export function LoyaltySettingsPanel({
  settings,
  onSaved,
}: {
  settings: LoyaltySettingsResponse;
  onSaved: () => Promise<void>;
}) {
  const { auth } = useSession();
  const [form, setForm] = useState({
    pointsPerEuro: String(settings.pointsPerEuro),
    welcomePoints: String(settings.welcomePoints),
  });
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    setForm({
      pointsPerEuro: String(settings.pointsPerEuro),
      welcomePoints: String(settings.welcomePoints),
    });
  }, [settings]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(auth, '/loyalty/settings', z.undefined(), {
        method: 'PUT',
        body: {
          pointsPerEuro: Number(form.pointsPerEuro),
          welcomePoints: Number(form.welcomePoints),
        },
      });
      setStatus(ts.saved);
      await onSaved();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => void save(e)}>
      <h2>{ts.title}</h2>
      <p className="muted">{ts.intro}</p>
      <div className="row wrap">
        <label className="stack">
          {ts.pointsPerEuro}
          <input
            required
            type="number"
            min={0}
            max={1000}
            value={form.pointsPerEuro}
            onChange={(e) => setForm({ ...form, pointsPerEuro: e.target.value })}
          />
        </label>
        <label className="stack">
          {ts.welcomePoints}
          <input
            required
            type="number"
            min={0}
            max={100000}
            value={form.welcomePoints}
            onChange={(e) => setForm({ ...form, welcomePoints: e.target.value })}
          />
        </label>
      </div>
      <div className="row">
        <button type="submit" className="primary">
          {ts.save}
        </button>
        {status ? (
          <span role="status" className="muted">
            {status}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Opérations envoyées à YouFID refusées ou à l'issue inconnue (lot 21) : jamais rejouées seules,
 * l'équipe vérifie le solde chez YouFID puis les marque comme vérifiées.
 */
export function LoyaltyOperationsPanel() {
  const { auth } = useSession();
  const ops = useApi('/loyalty/operations', operationsSchema);
  const [error, setError] = useState<string | null>(null);
  const list = ops.data?.operations ?? [];

  const resolve = async (id: string) => {
    if (!window.confirm(to.confirmResolve)) return;
    try {
      await api(auth, `/loyalty/operations/${id}/resolve`, z.undefined(), { method: 'POST' });
      setError(null);
      await ops.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  return (
    <section className="card stack">
      <h2>
        {to.title}{' '}
        {list.length > 0 ? <span className="pill danger">{to.badge(list.length)}</span> : null}
      </h2>
      <p className="muted">{to.intro}</p>
      {error ? (
        <p className="banner danger" role="alert">
          {error}
        </p>
      ) : null}
      {list.length === 0 ? <p className="muted">{to.none}</p> : null}
      {list.length > 0 ? (
        <table>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td>{new Date(o.updatedAt).toLocaleString('fr-FR')}</td>
                <td>
                  <strong>{to.kind[o.kind] ?? o.kind}</strong> · {o.label}
                  <br />
                  <span className="muted">
                    {to.member(o.memberId)} · {to.attempts(o.attempts)}
                  </span>
                </td>
                <td className="num">
                  {o.points > 0 ? '+' : ''}
                  {o.points}
                </td>
                <td>
                  <span className={o.status === 'uncertain' ? 'pill danger' : 'pill warning'}>
                    {to.status[o.status] ?? o.status}
                  </span>
                  {o.error ? <span className="muted"> {to.error[o.error] ?? o.error}</span> : null}
                </td>
                <td>
                  <button type="button" className="link" onClick={() => void resolve(o.id)}>
                    {to.resolve}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/** Origine de la fidélité de l'enseigne (YouFID ou test) ; null si pas de club. */
export function useLoyaltySettings() {
  return useApi('/loyalty/settings', loyaltySettingsResponseSchema);
}
