'use client';

import { messages } from '@splash360/i18n';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { storeDevToken } from '@/lib/session';
import { devLoginEnabled, supabase } from '@/lib/supabase';

const t = messages.admin.login;

/** Comptes de test affichés uniquement en recette (variable de build, jamais en production). */
const showTestAccounts = process.env.NEXT_PUBLIC_SHOW_TEST_ACCOUNTS === '1';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sb = supabase();
  const refused =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refus');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (sb) {
      const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (err) setError(t.error);
      else router.replace('/accueil');
      return;
    }
    const res = await fetch('/api/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    if (!res.ok) return setError(t.error);
    storeDevToken(((await res.json()) as { token: string }).token);
    router.replace('/accueil');
  };

  // Lien de réinitialisation : il ouvre la page « Choisir mon mot de passe » de ce back-office.
  const forgot = async () => {
    if (!sb) return;
    setError(null);
    if (!email.trim()) return setError(t.forgotNeedEmail);
    setBusy(true);
    await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/mot-de-passe/`,
    });
    setBusy(false);
    // Même message que le compte existe ou non : ne révèle pas les e-mails enregistrés.
    setNotice(t.forgotSent);
  };

  return (
    <div className="login">
      <aside className="login-aside">
        <div className="row">
          <span className="logo-mark" aria-hidden="true">
            S
          </span>
          <strong style={{ fontSize: 17 }}>Splash360</strong>
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <h2>{t.asideTitle}</h2>
          <p>{t.asideIntro}</p>
          <ul>
            {t.asidePoints.map((p) => (
              <li key={p} className="row">
                <Icon name="check" size={18} color="#4ADE80" stroke={2.5} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p style={{ fontSize: 13 }}>{messages.admin.title}</p>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <div>
            <p className="eyebrow">{t.welcome}</p>
            <h1>{sb ? t.title : t.devTitle}</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {t.intro}
            </p>
          </div>
          <form onSubmit={(e) => void submit(e)} className="card stack" aria-label={t.title}>
            {!sb && !devLoginEnabled ? <p className="error">{t.notConfigured}</p> : null}
            {!sb && devLoginEnabled ? <p className="muted">{t.devHelp}</p> : null}
            {refused ? (
              <p className="banner danger" role="alert">
                {t.error}
              </p>
            ) : null}
            <label>
              {t.email}
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {sb ? (
              <label>
                {t.password}
                <span className="row" style={{ gap: 8 }}>
                  <input
                    type={visible ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="ghost" onClick={() => setVisible((v) => !v)}>
                    {visible ? t.hide : t.show}
                  </button>
                </span>
              </label>
            ) : null}
            {error ? (
              <p className="error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            ) : null}
            <button type="submit" className="primary" disabled={busy || (!sb && !devLoginEnabled)}>
              {t.submit}
            </button>
            {sb ? (
              <button type="button" className="link" disabled={busy} onClick={() => void forgot()}>
                {t.forgot}
              </button>
            ) : null}
            {notice ? (
              <p role="status" className="muted" style={{ margin: 0 }}>
                {notice}
              </p>
            ) : null}
          </form>

          {showTestAccounts ? (
            <section className="test-accounts" aria-labelledby="test-accounts">
              <strong id="test-accounts">{t.testTitle}</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                {t.testHint}
              </p>
              <ul>
                {t.testAccounts.map((a) => (
                  <li key={a.email}>
                    <span>
                      <strong>{a.label}</strong>
                      <br />
                      <span className="muted">{a.email}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setEmail(a.email)}
                      aria-label={`${t.fill} : ${a.label}`}
                    >
                      {t.fill}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
