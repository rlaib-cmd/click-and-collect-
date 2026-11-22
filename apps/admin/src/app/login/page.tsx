'use client';

import { messages } from '@splash360/i18n';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { storeDevToken } from '@/lib/session';
import { devLoginEnabled, supabase } from '@/lib/supabase';

const t = messages.admin.login;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sb = supabase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (sb) {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (err) setError(t.error);
      else router.replace('/commandes');
      return;
    }
    const res = await fetch('/api/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) return setError(t.error);
    storeDevToken(((await res.json()) as { token: string }).token);
    router.replace('/commandes');
  };

  return (
    <main className="login">
      <form onSubmit={(e) => void submit(e)} className="card stack">
        <h1>{messages.admin.title}</h1>
        <h2>{sb ? t.title : t.devTitle}</h2>
        {!sb && !devLoginEnabled ? <p className="error">{t.notConfigured}</p> : null}
        {!sb && devLoginEnabled ? <p className="muted">{t.devHelp}</p> : null}
        <label>
          {t.email}
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {sb ? (
          <label>
            {t.password}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={busy || (!sb && !devLoginEnabled)}>
          {t.submit}
        </button>
      </form>
    </main>
  );
}
