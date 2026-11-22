'use client';

import { tenantThemeSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { buildPalette, contrastRatio, isHexColor } from '@splash360/theme';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.design;
type Theme = z.infer<typeof tenantThemeSchema>;

/** Design de l'application : logo, couleur, thème, slogan, avec aperçu et contrôle de contraste. */
export default function DesignPage() {
  const { auth, me } = useSession();
  const theme = useApi('/theme', tenantThemeSchema);
  const legal = useApi('/legal', z.object({ text: z.string().nullable() }));
  const [form, setForm] = useState<Theme | null>(null);
  const [legalText, setLegalText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (theme.data && !form) setForm(theme.data);
  }, [theme.data, form]);
  useEffect(() => {
    if (legal.data) setLegalText(legal.data.text ?? '');
  }, [legal.data]);
  if (!form) return <p className="muted">{messages.admin.common.loading}</p>;

  const valid = tenantThemeSchema.safeParse(form).success;
  const palette = buildPalette({
    primaryColor: isHexColor(form.primaryColor) ? form.primaryColor : '#1F6FEB',
    mode: form.mode,
  });
  const ratio = contrastRatio(palette.primary, palette.onPrimary).toFixed(1);

  const save = async () => {
    try {
      await api(auth, '/theme', z.undefined(), { method: 'PUT', body: form });
      await api(auth, '/legal', z.undefined(), {
        method: 'PUT',
        body: { text: legalText.trim() || null },
      });
      setStatus(messages.admin.common.saved);
    } catch {
      setStatus(messages.admin.common.error);
    }
  };

  return (
    <div className="stack">
      <h1>{messages.admin.nav.design}</h1>
      <div className="split">
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            {t.logo}
            <input
              type="url"
              value={form.logoUrl ?? ''}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value || null })}
              placeholder="https://"
            />
          </label>
          <label>
            {t.color}
            <span className="row">
              <input
                type="color"
                value={isHexColor(form.primaryColor) ? form.primaryColor : '#1F6FEB'}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value.toUpperCase() })}
                aria-label={t.color}
              />
              <input
                value={form.primaryColor}
                onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                maxLength={7}
              />
            </span>
          </label>
          <fieldset>
            <legend>{t.mode}</legend>
            {(['light', 'dark'] as const).map((m) => (
              <label key={m} className="inline">
                <input
                  type="radio"
                  name="mode"
                  checked={form.mode === m}
                  onChange={() => setForm({ ...form, mode: m })}
                />{' '}
                {t[m]}
              </label>
            ))}
          </fieldset>
          <label>
            {t.tagline}
            <input
              value={form.tagline ?? ''}
              maxLength={120}
              onChange={(e) => setForm({ ...form, tagline: e.target.value || null })}
            />
          </label>
          <p className="muted">
            {t.contrast(ratio, palette.onPrimary === '#000000' ? t.black : t.white)}
          </p>
          <label>
            {t.legal}
            <textarea rows={8} value={legalText} onChange={(e) => setLegalText(e.target.value)} />
          </label>
          <p className="muted">{t.nextStart}</p>
          <button type="submit" className="primary" disabled={!valid}>
            {messages.admin.common.save}
          </button>
          {status ? <p role="status">{status}</p> : null}
        </form>

        <section
          aria-label={t.preview}
          className="phone"
          style={{ background: palette.background, color: palette.text }}
        >
          {form.logoUrl ? (
            <img src={form.logoUrl} alt="" className="phone-logo" />
          ) : (
            <div
              className="phone-logo"
              style={{ background: palette.primary, color: palette.onPrimary }}
            >
              {(me.tenant?.name ?? 'S').charAt(0)}
            </div>
          )}
          <strong className="phone-title">{me.tenant?.name}</strong>
          {form.tagline ? <span style={{ color: palette.textMuted }}>{form.tagline}</span> : null}
          <span
            className="phone-button"
            style={{ background: palette.primary, color: palette.onPrimary }}
          >
            {messages.app.order}
          </span>
        </section>
      </div>
    </div>
  );
}
