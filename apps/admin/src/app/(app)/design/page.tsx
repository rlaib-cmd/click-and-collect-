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
import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Icon } from '@/components/Icon';
import { PhonePreview } from '@/components/PhonePreview';
import { api, CLIENT_APP_URL, upload } from '@/lib/api';
import { usePreviewData } from '@/lib/preview-data';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';

const t = messages.admin.design;
const s = messages.admin.studio;
type Theme = z.infer<typeof tenantThemeSchema>;

const AUTOSAVE_MS = 900;
const FALLBACK = '#3730A3';
const time = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').toUpperCase() === (b ?? '').toUpperCase();

/**
 * Apparence (maquette du lot 13, logique du studio design du lot 12, ADR 0016) : le formulaire
 * modifie un brouillon enregistré automatiquement ; l'aperçu suit en direct ; « Publier » le
 * rend visible aux clients.
 */
export default function DesignPage() {
  const { auth, me } = useSession();
  const [state, setState] = useState<ThemeDraftState | null>(null);
  const [form, setForm] = useState<Theme | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ThemeField[] | null>(null);
  const [phone, setPhone] = useState(false);
  const [toast, setToast] = useState(false);
  const lastSaved = useRef<string | null>(null);
  const preview = usePreviewData(me.tenant?.subdomain ?? null);

  const load = useCallback(async () => {
    const st = await api(auth, '/theme/draft', themeDraftStateSchema);
    setState(st);
    setForm(st.draft ?? st.live);
    lastSaved.current = JSON.stringify(st.draft ?? st.live);
  }, [auth]);

  useEffect(() => {
    void load().catch(() => setError(messages.admin.common.error));
  }, [load]);

  const saveDraft = useCallback(
    async (theme: Theme) => {
      const serialized = JSON.stringify(theme);
      if (serialized === lastSaved.current) return true;
      if (!tenantThemeSchema.safeParse(theme).success) {
        setError(t.draftInvalid);
        return false;
      }
      await api(auth, '/theme/draft', z.undefined(), { method: 'PUT', body: theme });
      lastSaved.current = serialized;
      setError(null);
      setSaved(time(new Date()));
      return true;
    },
    [auth],
  );

  // Enregistrement automatique du brouillon, peu après la dernière modification.
  useEffect(() => {
    if (!form) return;
    const id = setTimeout(() => {
      saveDraft(form).catch(() => setError(messages.admin.common.error));
    }, AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [form, saveDraft]);

  if (!form || !state) return <p className="muted">{error ?? messages.admin.common.loading}</p>;

  const changes = themeChanges(state.live, form);
  const valid = tenantThemeSchema.safeParse(form).success;
  const palette = buildPalette({
    primaryColor: isHexColor(form.primaryColor) ? form.primaryColor : FALLBACK,
    mode: form.mode,
    loyaltyColor: form.loyaltyColor && isHexColor(form.loyaltyColor) ? form.loyaltyColor : null,
  });

  const publish = async () => {
    try {
      await saveDraft(form);
      await api(auth, '/theme/publish', z.object({ changes: z.array(z.string()) }), {
        method: 'POST',
      });
      setConfirming(null);
      await load();
      setToast(true);
      setTimeout(() => setToast(false), 6000);
    } catch {
      setError(messages.admin.common.error);
    }
  };

  const discard = async () => {
    if (!window.confirm(t.discardConfirm)) return;
    try {
      await api(auth, '/theme/discard', z.undefined(), { method: 'POST' });
      await load();
    } catch {
      setError(messages.admin.common.error);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header className="row wrap" style={{ gap: 14 }}>
        <Link href="/accueil" className="row" style={{ gap: 6, fontWeight: 600, fontSize: 14 }}>
          <Icon name="back" size={18} />
          {s.back}
        </Link>
        <h1 style={{ fontSize: 26 }}>{messages.admin.nav.design}</h1>
        {changes.length > 0 ? (
          <span className="pill warning">{s.draft}</span>
        ) : (
          <span className="pill success">{s.upToDate}</span>
        )}
        <span className="grow" />
        <button
          type="button"
          className="ghost"
          disabled={changes.length === 0}
          onClick={() => void discard()}
        >
          {t.discard}
        </button>
        <button type="button" onClick={() => setPhone(true)}>
          <Icon name="phone" size={18} />
          {s.phoneButton}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!valid}
          onClick={() => setConfirming(changes)}
        >
          {t.publish}
        </button>
      </header>
      <p style={{ margin: 0, color: 'var(--text-2)' }}>
        {s.intro} <strong>{s.introStrong}</strong>
        {saved ? <span className="muted"> · {t.draftSaved(saved)}</span> : null}
      </p>
      {error ? (
        <p className="banner danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="studio">
        <div className="stack">
          <LogoStep form={form} setForm={setForm} primary={palette.primary} />
          <ColorStep form={form} setForm={setForm} palette={palette} />
          <StyleStep form={form} setForm={setForm} palette={palette} />
          <TextStep form={form} setForm={setForm} />
          <p className="banner info" style={{ fontSize: 13, alignItems: 'flex-start' }}>
            <Icon name="info" size={20} />
            <span style={{ flex: 1 }}>{s.updatesInfo}</span>
          </p>
        </div>
        <div className="studio-preview card stack" style={{ alignItems: 'center' }}>
          <PhonePreview theme={form} tenantName={me.tenant?.name ?? ''} data={preview} />
          <span className="muted" style={{ fontSize: 12 }}>
            {s.previewNote}
          </span>
        </div>
      </div>

      {confirming ? (
        <Dialog labelledBy="publish-title" onClose={() => setConfirming(null)}>
          <h2 id="publish-title" style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>
            {t.publishTitle}
          </h2>
          {confirming.length === 0 ? (
            <p className="muted">{s.noChange}</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {confirming.map((f) => (
                <DiffRow key={f} field={f} live={state.live} draft={form} />
              ))}
            </div>
          )}
          <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14 }}>{t.publishIntro}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setConfirming(null)}>
              {s.notNow}
            </button>
            <button
              type="button"
              className="primary"
              disabled={confirming.length === 0}
              onClick={() => void publish()}
            >
              {t.publishConfirm}
            </button>
          </div>
        </Dialog>
      ) : null}

      {phone ? (
        <PhoneDialog
          subdomain={me.tenant?.subdomain ?? null}
          beforeOpen={() => saveDraft(form)}
          onClose={() => setPhone(false)}
        />
      ) : null}

      {toast ? (
        <div role="status" className="toast">
          <Icon name="check" size={18} color="#4ADE80" stroke={2.5} />
          {s.publishedToast}
        </div>
      ) : null}
    </div>
  );
}

function Dialog({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal card stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

function DiffRow({ field, live, draft }: { field: ThemeField; live: Theme; draft: Theme }) {
  const color = (theme: Theme) =>
    field === 'primaryColor'
      ? theme.primaryColor
      : field === 'loyaltyColor'
        ? (theme.loyaltyColor ?? theme.primaryColor)
        : null;
  const before = color(live);
  const after = color(draft);
  return (
    <div className="diff-row">
      {before && after ? (
        <>
          <span className="chip-color" style={{ background: before }} />
          <Icon name="arrow" size={16} color="#5B5B66" />
          <span className="chip-color" style={{ background: after }} />
        </>
      ) : (
        <Icon name="edit" size={16} color="#5B5B66" />
      )}
      <span>{t.fields[field]}</span>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = `step-${n}`;
  return (
    <section className="card step-card" aria-labelledby={id}>
      <div className="step-title">
        <span className="step-num" aria-hidden="true">
          {n}
        </span>
        <h2 id={id}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

type StepProps = { form: Theme; setForm: (theme: Theme) => void };

function LogoStep({ form, setForm, primary }: StepProps & { primary: string }) {
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

  return (
    <Step n={1} title={s.stepLogo}>
      <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="logo-box" style={{ background: primary }}>
          {form.logoUrl ? <img src={form.logoUrl} alt={t.fields.logoUrl} /> : null}
        </div>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
        >
          <label className="button">
            {uploading ? t.logoUploading : form.logoUrl ? s.replaceLogo : s.addLogo}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              disabled={uploading}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            {s.dropHint}
          </span>
        </div>
      </div>
      {uploadError ? (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {uploadError}
        </p>
      ) : null}
      <details>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
          {t.logoUrlAlt}
        </summary>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <input
            type="url"
            aria-label={t.logoUrlAlt}
            value={form.logoUrl ?? ''}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value || null })}
            placeholder="https://"
            style={{ flex: 1, minWidth: 220 }}
          />
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
      </details>
    </Step>
  );
}

function Swatches({
  label,
  options,
  value,
  onPick,
  children,
}: {
  label: string;
  options: readonly (readonly [string, string])[];
  value: string | null;
  onPick: (hex: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {children}
      {options.map(([hex, name]) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={same(value, hex)}
          aria-label={name}
          title={name}
          className="swatch"
          style={{ background: hex }}
          onClick={() => onPick(hex)}
        />
      ))}
    </div>
  );
}

function ColorStep({
  form,
  setForm,
  palette,
}: StepProps & { palette: ReturnType<typeof buildPalette> }) {
  const ratio = contrastRatio(palette.primary, palette.onPrimary);
  const textName = palette.onPrimary === '#000000' ? t.black : t.white;
  return (
    <Step n={2} title={s.stepColors}>
      <div className="stack" style={{ gap: 10 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
          {s.primary}{' '}
          <span className="muted" style={{ fontWeight: 500 }}>
            · {s.primaryHint}
          </span>
        </p>
        <Swatches
          label={s.primary}
          options={s.swatches}
          value={form.primaryColor}
          onPick={(hex) => setForm({ ...form, primaryColor: hex })}
        />
        <div className="row wrap">
          <input
            type="color"
            aria-label={`${s.custom} (${s.primary})`}
            value={isHexColor(form.primaryColor) ? form.primaryColor : FALLBACK}
            onChange={(e) => setForm({ ...form, primaryColor: e.target.value.toUpperCase() })}
          />
          <input
            aria-label={`${s.primary} (#RRGGBB)`}
            value={form.primaryColor}
            onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
            maxLength={7}
            style={{ width: 120, fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
        </div>
        {ratio >= 4.5 ? (
          <p className="ok-line" style={{ margin: 0 }}>
            <Icon name="check" size={16} color="#15803D" stroke={2.5} />
            {s.readable(textName, ratio.toFixed(1))}
          </p>
        ) : (
          <p className="error" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {s.unreadable(ratio.toFixed(1))}
          </p>
        )}
      </div>
      <div style={{ height: 1, background: '#F0EEEA' }} />
      <div className="stack" style={{ gap: 10 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
          {s.loyalty}{' '}
          <span className="muted" style={{ fontWeight: 500 }}>
            · {s.loyaltyHint}
          </span>
        </p>
        <Swatches
          label={s.loyalty}
          options={s.loyaltySwatches}
          value={form.loyaltyColor}
          onPick={(hex) => setForm({ ...form, loyaltyColor: hex })}
        >
          <button
            type="button"
            role="radio"
            aria-checked={form.loyaltyColor === null}
            className="choice"
            style={{ flexDirection: 'row', padding: '10px 14px', borderRadius: 22 }}
            onClick={() => setForm({ ...form, loyaltyColor: null })}
          >
            {s.sameAsPrimary}
          </button>
        </Swatches>
        <div className="row wrap">
          <input
            type="color"
            aria-label={`${s.custom} (${s.loyalty})`}
            value={palette.loyalty}
            onChange={(e) => setForm({ ...form, loyaltyColor: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
    </Step>
  );
}

function StyleStep({
  form,
  setForm,
  palette,
}: StepProps & { palette: ReturnType<typeof buildPalette> }) {
  const setStyle = (patch: Partial<Theme['style']>) =>
    setForm({ ...form, style: { ...form.style, ...patch } });
  const corners = [
    ['pill', t.cornersPill, '999px'],
    ['rounded', t.cornersRounded, '10px'],
    ['square', t.cornersSquare, '2px'],
  ] as const;
  return (
    <Step n={3} title={s.stepStyle}>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{s.corners}</p>
      <div className="choice-grid" role="radiogroup" aria-label={s.corners}>
        {corners.map(([value, label, radius]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={form.style.corners === value}
            className="choice"
            onClick={() => setStyle({ corners: value })}
          >
            <span
              style={{
                width: 110,
                padding: '8px 0',
                borderRadius: radius,
                background: palette.primary,
                color: palette.onPrimary,
                fontWeight: 800,
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {s.order}
            </span>
            {label}
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 24 }}>
        <div className="stack" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{s.header}</span>
          <div className="segmented" role="tablist" aria-label={s.header}>
            {(
              [
                ['brand', t.headerBrand],
                ['plain', t.headerPlain],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={form.style.header === value}
                onClick={() => setStyle({ header: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{s.pattern}</span>
          <div className="segmented" role="tablist" aria-label={s.pattern}>
            {(
              [
                ['checker', t.patternChecker],
                ['none', t.patternNone],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={form.style.pattern === value}
                onClick={() => setStyle({ pattern: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{t.mode}</span>
          <div className="segmented" role="tablist" aria-label={t.mode}>
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={form.mode === m}
                onClick={() => setForm({ ...form, mode: m })}
              >
                {t[m]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="inline">
        <input
          type="checkbox"
          checked={form.style.uppercaseTitles}
          onChange={(e) => setStyle({ uppercaseTitles: e.target.checked })}
        />
        {t.uppercaseTitles}
      </label>
    </Step>
  );
}

function TextStep({ form, setForm }: StepProps) {
  const { auth } = useSession();
  const legal = useApi('/legal', z.object({ text: z.string().nullable() }));
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const value = text ?? legal.data?.text ?? '';
  return (
    <Step n={4} title={s.stepTexts}>
      <label>
        {t.tagline}
        <input
          value={form.tagline ?? ''}
          maxLength={120}
          onChange={(e) => setForm({ ...form, tagline: e.target.value || null })}
        />
      </label>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>{t.legal}</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <textarea
            aria-label={t.legal}
            rows={6}
            value={value}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            {t.legalHint}
          </span>
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
        </div>
      </details>
    </Step>
  );
}

/** Lien et QR code pour voir le brouillon dans la vraie application, sans publier. */
function PhoneDialog({
  subdomain,
  beforeOpen,
  onClose,
}: {
  subdomain: string | null;
  beforeOpen: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { auth } = useSession();
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subdomain) return;
    let cancelled = false;
    void (async () => {
      try {
        await beforeOpen();
        const res = await api(auth, '/theme/preview-link', themePreviewLinkSchema, {
          method: 'POST',
        });
        const url = `${CLIENT_APP_URL}/?enseigne=${encodeURIComponent(subdomain)}&preview=${encodeURIComponent(res.token)}`;
        const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
        if (!cancelled) setLink({ url, qr, expiresAt: new Date(res.expiresAt) });
      } catch {
        if (!cancelled) setError(messages.admin.common.error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Un seul lien par ouverture de la fenêtre.
  }, []);

  return (
    <Dialog labelledBy="phone-title" onClose={onClose}>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h2 id="phone-title" style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>
          {s.phoneTitle}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14 }}>{s.phoneIntro}</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {link ? (
          <>
            <img
              src={link.qr}
              alt={t.realApp}
              width={200}
              height={200}
              style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 8 }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {s.phoneValid(time(link.expiresAt))}
            </span>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <a href={link.url} target="_blank" rel="noreferrer" className="button">
                {t.realApp}
              </a>
              <button
                type="button"
                className="link"
                onClick={() =>
                  void navigator.clipboard.writeText(link.url).then(() => setCopied(true))
                }
              >
                {copied ? t.copied : t.copy}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{messages.admin.common.loading}</p>
        )}
        <button type="button" onClick={onClose} style={{ alignSelf: 'stretch' }}>
          {s.close}
        </button>
      </div>
    </Dialog>
  );
}
