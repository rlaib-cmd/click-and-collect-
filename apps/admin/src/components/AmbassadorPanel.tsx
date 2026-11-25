'use client';

import {
  adminAmbassadorEntriesSchema,
  ambassadorSettingsSchema,
  type AmbassadorSettingsDto,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.ambassador;
const settingsResponse = z.object({
  enabled: z.boolean(),
  instagramHandle: z.string().nullable(),
  bonusPoints: z.number().int(),
});

/**
 * Réglages « Ambassadeur » et participations reçues (lot 15, ADR 0019). Lecture seule des
 * participations : leur vérification sera automatique (mention Instagram, ticket Splash360).
 */
export function AmbassadorPanel() {
  const { auth } = useSession();
  const settings = useApi('/ambassador', settingsResponse);
  const entries = useApi('/ambassador/entries', adminAmbassadorEntriesSchema);
  const [form, setForm] = useState({ enabled: false, handle: '', bonus: '50' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      enabled: settings.data.enabled,
      handle: settings.data.instagramHandle ?? '',
      bonus: String(settings.data.bonusPoints),
    });
  }, [settings.data]);

  // Fonction absente de ce serveur : pas de panneau.
  if (settings.error) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const parsed = ambassadorSettingsSchema.safeParse({
      enabled: form.enabled,
      instagramHandle: form.handle.trim() === '' ? null : form.handle,
      bonusPoints: Number(form.bonus),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t.title);
    const body: AmbassadorSettingsDto = parsed.data;
    try {
      await api(auth, '/ambassador', z.undefined(), { method: 'PUT', body });
      setError(null);
      setNotice(t.saved);
      await settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  return (
    <section className="card stack" aria-labelledby="ambassadeur">
      <h2 id="ambassadeur">{t.title}</h2>
      <p className="muted">{t.intro}</p>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <label className="inline">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />{' '}
          {t.enabled}
        </label>
        <div className="row wrap">
          <label>
            {t.handle}
            <input
              value={form.handle}
              placeholder="billsburgerfr"
              onChange={(e) => setForm({ ...form, handle: e.target.value })}
            />
          </label>
          <label>
            {t.bonus}
            <input
              inputMode="numeric"
              value={form.bonus}
              onChange={(e) => setForm({ ...form, bonus: e.target.value })}
            />
          </label>
        </div>
        {error ? (
          <p className="banner danger" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="banner" role="status">
            {notice}
          </p>
        ) : null}
        <div>
          <button type="submit" className="primary">
            {t.save}
          </button>
        </div>
      </form>
      <p className="muted">{t.pendingNote}</p>
      <h3>{t.entries}</h3>
      {entries.data && entries.data.entries.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t.ticket}</th>
              <th>{t.instagram}</th>
              <th>{t.status}</th>
              <th className="num">{t.bonus}</th>
              <th>{t.date}</th>
            </tr>
          </thead>
          <tbody>
            {entries.data.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.ticketRef}</td>
                <td>@{e.instagramHandle}</td>
                <td>{t.statusLabel[e.status]}</td>
                <td className="num">{e.bonusPoints}</td>
                <td>{new Date(e.createdAt).toLocaleString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{messages.admin.common.none}</p>
      )}
    </section>
  );
}
