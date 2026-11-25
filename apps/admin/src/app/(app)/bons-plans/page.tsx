'use client';

import {
  adminProximitySchema,
  proximitySettingsSchema,
  type ProximitySettingsDto,
  type ProximityStatsDto,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { LoadError } from '@/components/LoadError';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.proximity;
const DEEP_LINKS = ['home', 'commander', 'avantages'] as const;
const TARGETS = ['all', 'reward', 'inactive'] as const;

/** Formulaire en texte (champs HTML), converti en règles au moment d'enregistrer. */
interface Form {
  enabled: boolean;
  radiusMeters: string;
  title: string;
  body: string;
  deepLink: ProximitySettingsDto['deepLink'];
  onlyOpeningHours: boolean;
  quiet: boolean;
  quietStart: string;
  quietEnd: string;
  memberCapHours: string;
  restaurantCapHours: string;
  target: ProximitySettingsDto['target'];
  inactiveDays: string;
}

const toForm = (s: ProximitySettingsDto): Form => ({
  enabled: s.enabled,
  radiusMeters: String(s.radiusMeters),
  title: s.title,
  body: s.body,
  deepLink: s.deepLink,
  onlyOpeningHours: s.onlyOpeningHours,
  quiet: s.quietHours !== null,
  quietStart: s.quietHours?.start ?? '21:00',
  quietEnd: s.quietHours?.end ?? '09:00',
  memberCapHours: String(s.memberCapHours),
  restaurantCapHours: String(s.restaurantCapHours),
  target: s.target,
  inactiveDays: String(s.inactiveDays),
});

function Stats({ stats }: { stats: ProximityStatsDto }) {
  return (
    <section className="card stack" aria-labelledby="proximity-stats">
      <h2 id="proximity-stats">{t.stats}</h2>
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">{t.sent}</th>
            <th className="num">{t.opened}</th>
            <th className="num">{t.orders}</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              [t.last7, stats.last7Days],
              [t.last30, stats.last30Days],
            ] as const
          ).map(([label, c]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{c.sent}</td>
              <td className="num">{c.opened}</td>
              <td className="num">{c.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t.optedIn(stats.optedInMembers)}</p>
    </section>
  );
}

/** Bons plans à proximité (lot 22, ADR 0027) : règles d'envoi et résultats. */
export default function ProximityPage() {
  const { auth } = useSession();
  const { data, error, reload } = useApi('/proximity', adminProximitySchema);
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(toForm(data.settings));
  }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const parsed = proximitySettingsSchema.safeParse({
      enabled: form.enabled,
      radiusMeters: Number(form.radiusMeters),
      title: form.title,
      body: form.body,
      deepLink: form.deepLink,
      onlyOpeningHours: form.onlyOpeningHours,
      quietHours: form.quiet ? { start: form.quietStart, end: form.quietEnd } : null,
      memberCapHours: Number(form.memberCapHours),
      restaurantCapHours: Number(form.restaurantCapHours),
      target: form.target,
      inactiveDays: Number(form.inactiveDays),
    });
    if (!parsed.success) return setStatus(t.invalid);
    try {
      await api(auth, '/proximity/settings', z.undefined(), { method: 'PUT', body: parsed.data });
      setStatus(t.saved);
      await reload();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="stack">
        <h1>{messages.admin.nav.proximity}</h1>
        <p className="muted">{t.unavailable}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <LoadError error={error} onRetry={() => void reload()} />
      <h1>{messages.admin.nav.proximity}</h1>
      <p className="muted">{t.intro}</p>
      {data ? <Stats stats={data.stats} /> : null}
      {form ? (
        <form className="card stack" onSubmit={(e) => void save(e)}>
          <h2>{t.rules}</h2>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />{' '}
            {t.enabled}
          </label>
          <label className="stack">
            {t.radius}
            <input
              required
              type="number"
              min={100}
              max={1000}
              step={10}
              value={form.radiusMeters}
              onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })}
            />
          </label>
          <label className="stack">
            {t.title}
            <input
              required
              maxLength={65}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="stack">
            {t.body}
            <textarea
              required
              maxLength={178}
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          <p className="muted">{t.placeholderHint}</p>
          <label className="stack">
            {t.deepLink}
            <select
              value={form.deepLink}
              onChange={(e) => setForm({ ...form, deepLink: e.target.value as Form['deepLink'] })}
            >
              {DEEP_LINKS.map((l) => (
                <option key={l} value={l}>
                  {t.deepLinks[l]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.onlyOpeningHours}
              onChange={(e) => setForm({ ...form, onlyOpeningHours: e.target.checked })}
            />{' '}
            {t.onlyOpeningHours}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.quiet}
              onChange={(e) => setForm({ ...form, quiet: e.target.checked })}
            />{' '}
            {t.quiet}
          </label>
          {form.quiet ? (
            <div className="row wrap">
              <label>
                {t.quietStart}{' '}
                <input
                  type="time"
                  value={form.quietStart}
                  onChange={(e) => setForm({ ...form, quietStart: e.target.value })}
                />
              </label>
              <label>
                {t.quietEnd}{' '}
                <input
                  type="time"
                  value={form.quietEnd}
                  onChange={(e) => setForm({ ...form, quietEnd: e.target.value })}
                />
              </label>
              <span className="muted">{t.quietHint}</span>
            </div>
          ) : null}
          <label className="stack">
            {t.memberCap}
            <input
              required
              type="number"
              min={1}
              max={720}
              value={form.memberCapHours}
              onChange={(e) => setForm({ ...form, memberCapHours: e.target.value })}
            />
          </label>
          <label className="stack">
            {t.restaurantCap}
            <input
              required
              type="number"
              min={1}
              max={2160}
              value={form.restaurantCapHours}
              onChange={(e) => setForm({ ...form, restaurantCapHours: e.target.value })}
            />
          </label>
          <fieldset className="stack">
            <legend>{t.target}</legend>
            {TARGETS.map((target) => (
              <label key={target} className="inline">
                <input
                  type="radio"
                  name="target"
                  checked={form.target === target}
                  onChange={() => setForm({ ...form, target })}
                />{' '}
                {t.targets[target]}
              </label>
            ))}
            {form.target === 'inactive' ? (
              <label className="stack">
                {t.inactiveDays}
                <input
                  required
                  type="number"
                  min={1}
                  max={365}
                  value={form.inactiveDays}
                  onChange={(e) => setForm({ ...form, inactiveDays: e.target.value })}
                />
              </label>
            ) : null}
          </fieldset>
          <div className="row">
            <button type="submit" className="primary">
              {t.save}
            </button>
            {status ? (
              <span role="status" className="muted">
                {status}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
