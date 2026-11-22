'use client';

import { tenantThemeSchema } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { buildPalette, contrastRatio, isHexColor, radiiFor } from '@splash360/theme';
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
    loyaltyColor: form.loyaltyColor && isHexColor(form.loyaltyColor) ? form.loyaltyColor : null,
  });
  const ratio = contrastRatio(palette.primary, palette.onPrimary).toFixed(1);
  const brand = form.style.header === 'brand';
  const radii = radiiFor(form.style.corners);
  const titleCss = form.style.uppercaseTitles
    ? ({ textTransform: 'uppercase', fontWeight: 900 } as const)
    : {};

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
          <label>
            {t.loyaltyColor}
            <span className="row">
              <input
                type="color"
                value={palette.loyalty}
                onChange={(e) => setForm({ ...form, loyaltyColor: e.target.value.toUpperCase() })}
                aria-label={t.loyaltyColor}
              />
              <input
                value={form.loyaltyColor ?? ''}
                placeholder={palette.primary}
                onChange={(e) => setForm({ ...form, loyaltyColor: e.target.value || null })}
                maxLength={7}
              />
              {form.loyaltyColor ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => setForm({ ...form, loyaltyColor: null })}
                >
                  {t.loyaltyColorReset}
                </button>
              ) : null}
            </span>
            <span className="muted">{t.loyaltyColorHint}</span>
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
          <fieldset>
            <legend>{t.header}</legend>
            {(
              [
                ['plain', t.headerPlain],
                ['brand', t.headerBrand],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline">
                <input
                  type="radio"
                  name="header"
                  checked={form.style.header === value}
                  onChange={() => setForm({ ...form, style: { ...form.style, header: value } })}
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t.corners}</legend>
            {(
              [
                ['rounded', t.cornersRounded],
                ['pill', t.cornersPill],
                ['square', t.cornersSquare],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline">
                <input
                  type="radio"
                  name="corners"
                  checked={form.style.corners === value}
                  onChange={() => setForm({ ...form, style: { ...form.style, corners: value } })}
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t.pattern}</legend>
            {(
              [
                ['none', t.patternNone],
                ['checker', t.patternChecker],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="inline">
                <input
                  type="radio"
                  name="pattern"
                  checked={form.style.pattern === value}
                  onChange={() => setForm({ ...form, style: { ...form.style, pattern: value } })}
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.style.uppercaseTitles}
              onChange={(e) =>
                setForm({ ...form, style: { ...form.style, uppercaseTitles: e.target.checked } })
              }
            />{' '}
            {t.uppercaseTitles}
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
          <div
            className="phone-head"
            style={brand ? { background: palette.primary, color: palette.onPrimary } : undefined}
          >
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="" className={brand ? 'phone-logo-wide' : 'phone-logo'} />
            ) : (
              <div
                className="phone-logo"
                style={{ background: palette.primary, color: palette.onPrimary }}
              >
                {(me.tenant?.name ?? 'S').charAt(0)}
              </div>
            )}
            {!brand || !form.logoUrl ? (
              <strong className="phone-title" style={titleCss}>
                {me.tenant?.name}
              </strong>
            ) : null}
            {form.tagline ? (
              <span style={{ ...titleCss, color: brand ? palette.onPrimary : palette.textMuted }}>
                {form.tagline}
              </span>
            ) : null}
          </div>
          {form.style.pattern === 'checker' ? (
            <div
              className="phone-checker"
              aria-hidden
              style={{
                backgroundImage: `repeating-conic-gradient(${palette.primary} 0 25%, ${palette.onPrimary} 0 50%)`,
              }}
            />
          ) : null}
          <span
            className="phone-button"
            style={{
              ...titleCss,
              background: palette.primary,
              color: palette.onPrimary,
              borderRadius: radii.button,
            }}
          >
            {messages.app.order}
          </span>
          <div
            className="phone-loyalty"
            style={{
              background: palette.loyalty,
              color: palette.onLoyalty,
              borderRadius: radii.card,
            }}
          >
            <strong style={titleCss}>{t.loyaltyPreview}</strong>
            <span
              className="phone-loyalty-badge"
              style={{ background: palette.onLoyalty, color: palette.loyalty }}
            >
              {messages.loyalty.vip}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
