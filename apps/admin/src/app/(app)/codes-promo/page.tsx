'use client';

import { adminPromosSchema, promoInputSchema, type AdminPromoDto } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.promos;
const createdSchema = z.object({ id: z.uuid() });

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const toCents = (v: string) => Math.round(Number(v.replace(',', '.')) * 100);
const describe = (p: AdminPromoDto) =>
  p.kind === 'percent' ? `−${p.value} %` : `−${euros(p.value)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

const EMPTY = {
  code: '',
  kind: 'percent' as 'percent' | 'fixed',
  value: '',
  minSubtotal: '',
  startsAt: '',
  endsAt: '',
  maxUses: '',
};

/** Codes promo de l'enseigne (lot 11, ADR 0015) : création, désactivation, utilisations. */
export default function PromosPage() {
  const { auth } = useSession();
  const { data, error: loadError, reload } = useApi('/promos', adminPromosSchema);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const body = promoInputSchema.safeParse({
      code: form.code,
      kind: form.kind,
      value: form.kind === 'percent' ? Number(form.value) : toCents(form.value),
      minSubtotalCents: form.minSubtotal ? toCents(form.minSubtotal) : 0,
      startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
    });
    if (!body.success) return setError(messages.admin.common.error);
    try {
      await api(auth, '/promos', createdSchema, { method: 'POST', body: body.data });
      setForm(EMPTY);
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const toggle = async (p: AdminPromoDto) => {
    await api(auth, `/promos/${p.id}`, z.undefined(), {
      method: 'PATCH',
      body: { active: !p.active },
    });
    await reload();
  };

  if (loadError instanceof ApiError && loadError.status === 404) {
    return (
      <div className="stack">
        <h1>{messages.admin.nav.promos}</h1>
        <p className="muted">{messages.admin.common.error}</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{messages.admin.nav.promos}</h1>
      <p className="muted">{t.hint}</p>
      <table>
        <thead>
          <tr>
            <th>{t.code}</th>
            <th>{t.kind}</th>
            <th className="num">{t.minSubtotal}</th>
            <th>{t.startsAt}</th>
            <th>{t.endsAt}</th>
            <th className="num">{t.uses}</th>
            <th>{t.status}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.promos.length === 0 ? (
            <tr>
              <td colSpan={8} className="muted">
                {t.empty}
              </td>
            </tr>
          ) : null}
          {data?.promos.map((p) => (
            <tr key={p.id} className={p.active ? '' : 'muted'}>
              <td>
                <strong>{p.code}</strong>
              </td>
              <td>{describe(p)}</td>
              <td className="num">{p.minSubtotalCents > 0 ? euros(p.minSubtotalCents) : '—'}</td>
              <td>{day(p.startsAt)}</td>
              <td>{day(p.endsAt)}</td>
              <td className="num">
                {p.uses} / {p.maxUses ?? t.unlimited}
              </td>
              <td>{p.active ? t.active : t.inactive}</td>
              <td>
                <button type="button" className="link" onClick={() => void toggle(p)}>
                  {p.active ? t.deactivate : t.activate}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="card stack" onSubmit={(e) => void create(e)}>
        <h2>{t.create}</h2>
        <div className="row wrap">
          <input
            required
            aria-label={t.code}
            placeholder={t.code}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
          <select
            aria-label={t.kind}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'percent' | 'fixed' })}
          >
            <option value="percent">{t.percent}</option>
            <option value="fixed">{t.fixed}</option>
          </select>
          <input
            required
            inputMode="decimal"
            aria-label={form.kind === 'percent' ? t.valuePercent : t.valueEuros}
            placeholder={form.kind === 'percent' ? t.valuePercent : t.valueEuros}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
          <input
            inputMode="decimal"
            aria-label={t.minSubtotal}
            placeholder={t.minSubtotal}
            value={form.minSubtotal}
            onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
          />
          <label className="row">
            {t.startsAt}
            <input
              type="date"
              aria-label={t.startsAt}
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </label>
          <label className="row">
            {t.endsAt}
            <input
              type="date"
              aria-label={t.endsAt}
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          <input
            inputMode="numeric"
            aria-label={t.maxUses}
            placeholder={`${t.maxUses} (${t.unlimited.toLowerCase()})`}
            value={form.maxUses}
            onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
          />
          <button type="submit" className="primary">
            {t.create}
          </button>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
