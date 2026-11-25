'use client';

import {
  adminAmbassadorEntriesSchema,
  adminAmbassadorEntrySchema,
  ambassadorSettingsSchema,
  type AdminAmbassadorEntryDto,
  type AmbassadorEventDto,
  type AmbassadorSettingsInput,
} from '@splash360/contracts';
import { can } from '@splash360/core';
import { messages } from '@splash360/i18n';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, euros } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.ambassador;
const settingsResponse = z.object({
  enabled: z.boolean(),
  instagramHandle: z.string().nullable(),
  bonusPoints: z.number().int(),
  checkAfterHours: z.number().int().default(20),
  creditAfterHours: z.number().int().default(24),
  photoCategory: z.string().default('restaurant'),
});

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR') : '—');
/** « 2026-11-24 » → « 24/11/2026 ». */
const day = (date: string) => date.split('-').reverse().join('/');

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const verdicts: Readonly<Record<string, string>> = t.verdictLabel;

/** Valeur lisible d'un détail d'événement (dates, verdicts, résultats du contrôle). */
function detailValue(key: string, value: string | number | boolean | null): string {
  if (typeof value === 'string' && ISO.test(value)) return when(value);
  if (key === 'verdict' && typeof value === 'string') return verdicts[value] ?? value;
  if (key === 'result' && typeof value === 'string') return t.resultLabel[value] ?? value;
  if (key === 'totalCents' && typeof value === 'number') return euros(value);
  return String(value);
}

function eventLine(e: AmbassadorEventDto): string {
  const detail = Object.entries(e.detail)
    .map(([k, v]) => `${t.detailLabel[k] ?? k} : ${detailValue(k, v)}`)
    .join(' · ');
  const actor = t.actorLabel[e.actor] ?? e.actor;
  return `${when(e.at)} — ${t.eventLabel[e.type]} ${t.by(actor)}${detail ? ` (${detail})` : ''}`;
}

/**
 * Fidélité → Ambassadeur (lots 15 et 17, ADR 0019 et 0022) : réglages (bonus, délais, catégorie)
 * et suivi des participations, avec « Mention reçue », « Refuser », « Valider maintenant »
 * (propriétaire et Splash360) et l'historique complet de chacune.
 */
export function AmbassadorPanel() {
  const { auth, me } = useSession();
  const settings = useApi('/ambassador', settingsResponse);
  const entries = useApi('/ambassador/entries', adminAmbassadorEntriesSchema);
  const [form, setForm] = useState({
    enabled: false,
    handle: '',
    bonus: '50',
    checkAfter: '20',
    creditAfter: '24',
    category: 'restaurant',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canValidate = can(me.role, 'loyalty.validate');

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      enabled: settings.data.enabled,
      handle: settings.data.instagramHandle ?? '',
      bonus: String(settings.data.bonusPoints),
      checkAfter: String(settings.data.checkAfterHours),
      creditAfter: String(settings.data.creditAfterHours),
      category: settings.data.photoCategory,
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
      checkAfterHours: Number(form.checkAfter),
      creditAfterHours: Number(form.creditAfter),
      photoCategory: form.category,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t.title);
    const body: AmbassadorSettingsInput = parsed.data;
    try {
      await api(auth, '/ambassador', z.undefined(), { method: 'PUT', body });
      setError(null);
      setNotice(t.saved);
      await settings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    }
  };

  const act = async (
    entry: AdminAmbassadorEntryDto,
    verb: 'mention' | 'reject' | 'validate',
    body: Record<string, string> = {},
  ) => {
    setBusy(entry.id);
    try {
      await api(auth, `/ambassador/entries/${entry.id}/${verb}`, adminAmbassadorEntrySchema, {
        method: 'POST',
        body,
      });
      setError(null);
      await entries.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.admin.common.error);
    } finally {
      setBusy(null);
    }
  };

  const reject = (entry: AdminAmbassadorEntryDto) => {
    const reason = window.prompt(t.rejectReason);
    if (reason === null) return;
    void act(entry, 'reject', reason.trim() ? { reason: reason.trim() } : {});
  };

  const validate = (entry: AdminAmbassadorEntryDto) => {
    if (window.confirm(t.confirmValidate(entry.bonusPoints))) void act(entry, 'validate');
  };

  const number = (key: 'bonus' | 'checkAfter' | 'creditAfter', label: string) => (
    <label>
      {label}
      <input
        inputMode="numeric"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

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
          {number('bonus', t.bonus)}
        </div>
        <div className="row wrap">
          {number('checkAfter', t.checkAfter)}
          {number('creditAfter', t.creditAfter)}
          <label>
            {t.category}
            <input
              value={form.category}
              placeholder={t.categoryHint}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
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
              <th>{t.photo}</th>
              <th>{t.creditDue}</th>
              <th>{t.date}</th>
              <th>{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {entries.data.entries.map((e) => {
              const pending = e.status === 'pending';
              return (
                <Fragment key={e.id}>
                  <tr>
                    <td>
                      {e.ticketRef}
                      {e.scanned ? (
                        <span className="badge" title={t.scannedHint} style={{ marginLeft: 6 }}>
                          {t.scanned}
                        </span>
                      ) : null}
                      {e.ticketCheck !== 'unverified' ? (
                        <span
                          className={`badge${e.ticketCheck === 'verified' ? '' : ' warn'}`}
                          title={t.ticketCheckHint}
                          style={{ marginLeft: 6 }}
                        >
                          {t.ticketCheckLabel[e.ticketCheck]}
                        </span>
                      ) : (
                        <div className="muted">{t.ticketCheckLabel.unverified}</div>
                      )}
                      {e.ticketNumber && e.ticketDate && e.ticketTotalCents !== null ? (
                        <div className="muted">
                          {t.ticketRead(
                            e.ticketNumber,
                            day(e.ticketDate),
                            euros(e.ticketTotalCents),
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td>@{e.instagramHandle}</td>
                    <td>
                      {t.stageLabel[e.stage]}
                      {pending && e.needsReview ? (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          {t.toReview}
                        </span>
                      ) : null}
                    </td>
                    <td title={e.photoReason ?? undefined}>
                      {e.photoVerdict ? t.verdictLabel[e.photoVerdict] : t.notAnalyzed}
                      {e.photoReason ? <div className="muted">{e.photoReason}</div> : null}
                    </td>
                    <td>{pending ? when(e.creditDueAt) : '—'}</td>
                    <td>{when(e.createdAt)}</td>
                    <td>
                      <div className="row wrap">
                        {pending && !e.mentionReceivedAt ? (
                          <button
                            type="button"
                            disabled={busy === e.id}
                            onClick={() => void act(e, 'mention')}
                          >
                            {t.mention}
                          </button>
                        ) : null}
                        {pending ? (
                          <button
                            type="button"
                            className="danger"
                            disabled={busy === e.id}
                            onClick={() => reject(e)}
                          >
                            {t.reject}
                          </button>
                        ) : null}
                        {pending && canValidate ? (
                          <button
                            type="button"
                            disabled={busy === e.id}
                            onClick={() => validate(e)}
                          >
                            {t.validate}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ghost"
                          aria-expanded={open === e.id}
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {open === e.id ? t.hideHistory : t.history}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open === e.id ? (
                    <tr>
                      <td colSpan={7}>
                        <ol className="stack" aria-label={t.history}>
                          {e.events.map((ev, i) => (
                            <li key={`${ev.type}-${i}`}>{eventLine(ev)}</li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">{messages.admin.common.none}</p>
      )}
    </section>
  );
}
