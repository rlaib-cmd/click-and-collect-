'use client';

import { messages } from '@splash360/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

const t = messages.admin.password;
const MIN_LENGTH = 8;

/**
 * Page ouverte par le lien d'invitation ou de réinitialisation (Supabase Auth) : la session
 * est lue dans l'URL par supabase-js, puis l'utilisateur choisit son mot de passe.
 */
export default function PasswordPage() {
  const router = useRouter();
  const sb = supabase();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sb) {
      setState('invalid');
      return;
    }
    // Lien expiré : Supabase renvoie l'erreur dans l'URL au lieu d'une session.
    if (/error_code=|error=/.test(window.location.hash + window.location.search)) {
      setState('invalid');
      return;
    }
    let done = false;
    const accept = (mail: string | undefined) => {
      done = true;
      setEmail(mail ?? '');
      setState('ready');
    };
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) accept(session.user.email);
    });
    void sb.auth.getSession().then(({ data: current }) => {
      if (current.session) accept(current.session.user.email);
      else if (!done) setState('invalid');
    });
    return () => data.subscription.unsubscribe();
  }, [sb]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sb) return;
    if (password.length < MIN_LENGTH) return setError(t.tooShort);
    if (password !== confirm) return setError(t.mismatch);
    setBusy(true);
    const { error: err } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(t.error);
    router.replace('/commandes');
  };

  return (
    <main className="login">
      <form onSubmit={(e) => void submit(e)} className="card stack">
        <h1>{messages.admin.title}</h1>
        <h2>{t.title}</h2>
        {state === 'checking' ? <p className="muted">{t.checking}</p> : null}
        {state === 'invalid' ? (
          <>
            <p className="error" role="alert">
              {t.invalid}
            </p>
            <a href="/login/">{t.backToLogin}</a>
          </>
        ) : null}
        {state === 'ready' ? (
          <>
            {email ? <p className="muted">{t.intro(email)}</p> : null}
            <label>
              {t.password}
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {t.confirm}
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="primary" disabled={busy}>
              {t.submit}
            </button>
          </>
        ) : null}
      </form>
    </main>
  );
}
