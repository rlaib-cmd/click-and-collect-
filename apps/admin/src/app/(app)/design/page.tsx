'use client';

import {
  logoUploadResultSchema,
  tenantThemeSchema,
  themeDraftStateSchema,
  themePreviewLinkSchema,
  type ThemeDraftState,
} from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import {
  buildPalette,
  contrastRatio,
  isHexColor,
  themeChanges,
  type ThemeField,
} from '@splash360/theme';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { PhonePreview } from '@/components/PhonePreview';
import { api, CLIENT_APP_URL, upload } from '@/lib/api';
import { usePreviewData } from '@/lib/preview-data';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.design;
type Theme = z.infer<typeof tenantThemeSchema>;

const AUTOSAVE_MS = 900;
const time = (d: Date) =>
  d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Studio design (lot 12, ADR 0016) : le formulaire modifie un brouillon, enregistré
 * automatiquement et prévisualisé en direct ; « Publier » le rend visible aux clients.
 */
export default function DesignPage() {
  const { auth, me } = useSession();
  const [state, setState] = useState<ThemeDraftState | null>(null);
  const [form, setForm] = useState<Theme | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ThemeField[] | null>(null);
  const lastSaved = useRef<string | null>(null);
  const preview = usePreviewData(me.tenant?.subdomain ?? null);

  const load = useCallback(async () => {
    const s = await api(auth, '/theme/draft', themeDraftStateSchema);
    setState(s);
    const initial = s.draft ?? s.live;
    setForm(initial);
    lastSaved.current = JSON.stringify(s.draft ?? s.live);
  }, [auth]);

  useEffect(() => {
    void load().catch(() => setStatus(messages.admin.common.error));
  }, [load]);

  const saveDraft = useCallback(
    async (theme: Theme) => {
      const serialized = JSON.stringify(theme);
      if (serialized === lastSaved.current) return true;
      if (!tenantThemeSchema.safeParse(theme).success) {
        setStatus(t.draftInvalid);
        return false;
      }
      setStatus(t.savingDraft);
      await api(auth, '/theme/draft', z.undefined(), { method: 'PUT', body: theme });
      lastSaved.current = serialized;
      setStatus(t.draftSaved(time(new Date())));
      return true;
    },
    [auth],
  );

  // Enregistrement automatique du brouillon, peu après la dernière modification.
  useEffect(() => {
    if (!form) return;
    const id = setTimeout(() => {
      saveDraft(form).catch(() => setStatus(messages.admin.common.error));
    }, AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [form, saveDraft]);

  if (!form || !state) return <p className="muted">{status ?? messages.admin.common.loading}</p>;

  const changes = themeChanges(state.live, form);
  const valid = tenantThemeSchema.safeParse(form).success;
  const palette = buildPalette({
    primaryColor: isHexColor(form.primaryColor) ? form.primaryColor : '#1F6FEB',
    mode: form.mode,
    loyaltyColor: form.loyaltyColor && isHexColor(form.loyaltyColor) ? form.loyaltyColor : null,
  });
  const ratio = contrastRatio(palette.primary, palette.onPrimary).toFixed(1);

  const publish = async () => {
    try {
      await saveDraft(form);
      await api(auth, '/theme/publish', z.object({ changes: z.array(z.string()) }), {
        method: 'POST',
      });
      setConfirming(null);
      await load();
      setStatus(t.published);
    } catch {
      setStatus(messages.admin.common.error);
    }
  };

  const discard = async () => {
    if (!window.confirm(t.discardConfirm)) return;
    try {
      await api(auth, '/theme/discard', z.undefined(), { method: 'POST' });
      await load();
      setStatus(t.discarded);
    } catch {
      setStatus(messages.admin.common.error);
    }
  };

  return (
    <div className="stack">
      <div className="row wrap studio-head">
        <h1>{messages.admin.nav.design}</h1>
        {changes.length > 0 ? (
          <span className="badge warn">{t.draftBadge}</span>
        ) : (
          <span className="badge">{t.upToDate}</span>
        )}
        <span className="grow" />
        <button
          type="button"
          className="link"
          disabled={changes.length === 0}
          onClick={() => void discard()}
        >
          {t.discard}
        </button>
        <button
          type="button"
          className="primary"
          disabled={changes.length === 0 || !valid}
          onClick={() => setConfirming(changes)}
        >
          {t.publish}
        </button>
      </div>
      <p className="muted">{t.studioIntro}</p>
      {status ? (
        <p role="status" className="muted">
          {status}
        </p>
      ) : null}

      <div className="studio">
        <div className="stack">
          <DesignForm form={form} setForm={setForm} ratio={ratio} palette={palette} />
          <PreviewLink
            subdomain={me.tenant?.subdomain ?? null}
            beforeOpen={() => saveDraft(form)}
          />
          <UpdatesInfo />
          <LegalEditor />
        </div>
        <div className="studio-preview">
          <PhonePreview theme={form} tenantName={me.tenant?.name ?? ''} data={preview} />
        </div>
      </div>

      {confirming ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal card stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-title"
          >
            <h2 id="publish-title">{t.publishTitle}</h2>
            <ul>
              {confirming.map((f) => (
                <li key={f}>{t.fields[f]}</li>
              ))}
            </ul>
            <p className="muted">{t.publishIntro}</p>
            <div className="row">
              <button type="button" onClick={() => setConfirming(null)}>
                {t.cancel}
              </button>
              <button type="button" className="primary" onClick={() => void publish()}>
                {t.publishConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DesignForm({
  form,
  setForm,
  ratio,
  palette,
}: {
  form: Theme;
  setForm: (theme: Theme) => void;
  ratio: string;
  palette: ReturnType<typeof buildPalette>;
}) {
  const { auth } = useSession();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { logoUrl } = await upload(auth, '/theme/logo', file, logoUploadResultSchema);
      setForm({ ...form, logoUrl });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : messages.admin.common.error);
    } finally {
      setUploading(false);
    }
  };

  const radio = <K extends 'header' | 'corners' | 'pattern'>(
    key: K,
    options: readonly (readonly [Theme['style'][K], string])[],
    legend: string,
  ) => (
    <fieldset>
      <legend>{legend}</legend>
      {options.map(([value, label]) => (
        <label key={String(value)} className="inline">
          <input
            type="radio"
            name={key}
            checked={form.style[key] === value}
            onChange={() => setForm({ ...form, style: { ...form.style, [key]: value } })}
          />{' '}
          {label}
        </label>
      ))}
    </fieldset>
  );

  return (
    <form className="card stack" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>{t.fields.logoUrl}</legend>
        <div className="row wrap">
          {form.logoUrl ? (
            <img
              src={form.logoUrl}
              alt=""
              className="logo-thumb"
              style={{ background: palette.primary }}
            />
          ) : null}
          <label className="button">
            {uploading ? t.logoUploading : t.logoUpload}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              disabled={uploading}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {form.logoUrl ? (
            <button
              type="button"
              className="link"
              onClick={() => setForm({ ...form, logoUrl: null })}
            >
              {t.logoRemove}
            </button>
          ) : null}
        </div>
        <span className="muted">{t.logoHint}</span>
        {uploadError ? (
          <span className="error" role="alert">
            {uploadError}
          </span>
        ) : null}
        <label>
          {t.logoUrlAlt}
          <input
            type="url"
            value={form.logoUrl ?? ''}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value || null })}
            placeholder="https://"
          />
        </label>
      </fieldset>
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
        <span className="muted">
          {t.contrast(ratio, palette.onPrimary === '#000000' ? t.black : t.white)}
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
      {radio(
        'header',
        [
          ['plain', t.headerPlain],
          ['brand', t.headerBrand],
        ],
        t.header,
      )}
      {radio(
        'corners',
        [
          ['rounded', t.cornersRounded],
          ['pill', t.cornersPill],
          ['square', t.cornersSquare],
        ],
        t.corners,
      )}
      {radio(
        'pattern',
        [
          ['none', t.patternNone],
          ['checker', t.patternChecker],
        ],
        t.pattern,
      )}
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
    </form>
  );
}

/** Lien et QR code pour voir le brouillon dans la vraie application, sans publier. */
function PreviewLink({
  subdomain,
  beforeOpen,
}: {
  subdomain: string | null;
  beforeOpen: () => Promise<boolean>;
}) {
  const { auth } = useSession();
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!subdomain) return;
    setError(null);
    try {
      await beforeOpen();
      const res = await api(auth, '/theme/preview-link', themePreviewLinkSchema, {
        method: 'POST',
      });
      const url = `${CLIENT_APP_URL}/?enseigne=${encodeURIComponent(subdomain)}&preview=${encodeURIComponent(res.token)}`;
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      setLink({ url, qr, expiresAt: new Date(res.expiresAt) });
      setCopied(false);
    } catch {
      setError(messages.admin.common.error);
    }
  };

  return (
    <section className="card stack" aria-labelledby="real-app">
      <h2 id="real-app">{t.realApp}</h2>
      <p className="muted">{t.realAppHint}</p>
      <div className="row wrap">
        <button type="button" onClick={() => void create()} disabled={!subdomain}>
          {t.realAppCreate}
        </button>
        {link ? (
          <button
            type="button"
            className="link"
            onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopied(true))}
          >
            {copied ? t.copied : t.copy}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {link ? (
        <div className="row wrap preview-link">
          <img src={link.qr} alt="" width={160} height={160} />
          <div className="stack">
            <a href={link.url} target="_blank" rel="noreferrer">
              {link.url}
            </a>
            <span className="muted">{t.expiresAt(time(link.expiresAt))}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function UpdatesInfo() {
  return (
    <section className="card stack" aria-label={t.instantTitle}>
      <div>
        <strong>✅ {t.instantTitle}</strong>
        <p className="muted">{t.instantList}</p>
      </div>
      <div>
        <strong>📦 {t.storeTitle}</strong>
        <p className="muted">{t.storeList}</p>
      </div>
    </section>
  );
}

function LegalEditor() {
  const { auth } = useSession();
  const legal = useApi('/legal', z.object({ text: z.string().nullable() }));
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const value = text ?? legal.data?.text ?? '';
  return (
    <section className="card stack">
      <label>
        {t.legal}
        <textarea rows={6} value={value} onChange={(e) => setText(e.target.value)} />
      </label>
      <span className="muted">{t.legalHint}</span>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void api(auth, '/legal', z.undefined(), {
              method: 'PUT',
              body: { text: value.trim() || null },
            }).then(
              () => setStatus(messages.admin.common.saved),
              () => setStatus(messages.admin.common.error),
            )
          }
        >
          {t.legalSave}
        </button>
        {status ? <span role="status">{status}</span> : null}
      </div>
    </section>
  );
}
