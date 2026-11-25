'use client';

import { clubMemberSchema, pointsAdjustSchema, type ClubMemberDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { AmbassadorPanel } from '@/components/AmbassadorPanel';
import { LoadError } from '@/components/LoadError';

const t = messages.admin.club;
const membersSchema = z.object({ members: z.array(clubMemberSchema) });
const pointsSchema = z.object({ points: z.number().int() });

/** « +33612345678 » → « 06 12 34 56 78 ». */
const formatFrenchPhone = (e164: string) =>
  /^\+33\d{9}$/.test(e164) ? `0${e164.slice(3).replace(/(\d)(?=(\d{2})+$)/g, '$1 ')}` : e164;

/** Club fidélité de l'enseigne (lot 9) : recherche, correction des points, suppression RGPD. */
export default function ClubPage() {
  const { auth } = useSession();
  const [q, setQ] = useState('');
  const {
    data,
    error: loadError,
    reload,
  } = useApi(
    `/loyalty/members${q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    membersSchema,
  );
  const [editing, setEditing] = useState<ClubMemberDto | null>(null);
  const [form, setForm] = useState({ delta: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  if (loadError instanceof ApiError && loadError.status === 404) {
    return (
      <div className="stack">
        <h1>{messages.admin.nav.club}</h1>
        <p className="muted">{t.noClub}</p>
      </div>
    );
  }

  const adjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const body = pointsAdjustSchema.safeParse({
      delta: Number(form.delta.replace('−', '-')),
      reason: form.reason,
    });
    if (!body.success) return setError(messages.admin.common.error);
    try {
      await api(auth, `/loyalty/members/${editing.id}/adjust`, pointsSchema, {
        method: 'POST',
        body: body.data,
      });
      setEditing(null);
      setForm({ delta: '', reason: '' });
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const remove = async (m: ClubMemberDto) => {
    if (!window.confirm(t.confirmDelete(m.name))) return;
    try {
      await api(auth, `/loyalty/members/${m.id}`, z.undefined(), { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  return (
    <div className="stack">
      <LoadError
        error={loadError instanceof ApiError && loadError.status === 404 ? null : loadError}
        onRetry={() => void reload()}
      />
      <h1>{messages.admin.nav.club}</h1>
      <p className="muted">{t.demo}</p>
      <AmbassadorPanel />
      {error ? (
        <p className="banner danger" role="alert">
          {error}
        </p>
      ) : null}
      <input
        type="search"
        placeholder={t.search}
        aria-label={t.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {editing ? (
        <form className="card row wrap" onSubmit={(e) => void adjust(e)}>
          <strong>
            {t.adjust} : {editing.name} ({editing.points})
          </strong>
          <input
            required
            inputMode="numeric"
            placeholder={t.delta}
            aria-label={t.delta}
            value={form.delta}
            onChange={(e) => setForm({ ...form, delta: e.target.value })}
          />
          <input
            required
            placeholder={t.reason}
            aria-label={t.reason}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <button type="submit" className="primary">
            {t.apply}
          </button>
          <button type="button" className="link" onClick={() => setEditing(null)}>
            {messages.admin.common.cancel}
          </button>
        </form>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{messages.admin.team.name}</th>
            <th>{t.phone}</th>
            <th>E-mail</th>
            <th>{t.card}</th>
            <th className="num">{t.points}</th>
            <th>{t.since}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.phone ? formatFrenchPhone(m.phone) : '—'}</td>
              <td>{m.email ?? '—'}</td>
              <td>{m.cardCode}</td>
              <td className="num">{m.points}</td>
              <td>{new Date(m.createdAt).toLocaleDateString('fr-FR')}</td>
              <td className="row">
                <button type="button" className="link" onClick={() => setEditing(m)}>
                  {t.adjust}
                </button>
                <button type="button" className="link danger" onClick={() => void remove(m)}>
                  {t.delete}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.members.length === 0 ? <p className="muted">{messages.admin.common.none}</p> : null}
    </div>
  );
}
