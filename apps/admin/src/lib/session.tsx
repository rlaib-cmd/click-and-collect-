'use client';

import { meSchema, type Me } from '@splash360/contracts';
import { messages } from '@splash360/i18n';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type Auth } from './api';
import { supabase } from './supabase';

const DEV_TOKEN = 'splash360:dev-token';
const TENANT = 'splash360:tenant';

interface Session {
  readonly auth: Auth;
  readonly me: Me;
  /**
   * Faux pendant la résolution d'un changement d'enseigne ou après un refus de session :
   * les lectures dépendantes sont alors suspendues (pas d'appel avec un contexte périmé).
   */
  readonly ready: boolean;
  setTenant(id: string | null): void;
  /** Session refusée (401) par une lecture : suspend tout et renvoie une seule fois à la connexion. */
  reportUnauthorized(): void;
  logout(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession hors de <SessionProvider>');
  return s;
}

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la session reste en mémoire */
  }
}

export function storeDevToken(token: string) {
  write(DEV_TOKEN, token);
}

/** Session du back-office : jeton Supabase (ou de développement) et enseigne courante. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // Enseigne demandée dont la réponse /me n'est pas encore arrivée (changement en cours).
  const [resolving, setResolving] = useState(false);
  const [refused, setRefused] = useState(false);
  // Échec de /me hors refus de session : message et reprise sur clic, sans relance automatique.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const meGeneration = useRef(0);
  const redirected = useRef(false);

  useEffect(() => {
    setTenantId(read(TENANT));
    const dev = read(DEV_TOKEN);
    if (dev) {
      setToken(dev);
      return;
    }
    const sb = supabase();
    if (!sb) {
      setToken(null);
      return;
    }
    void sb.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data } = sb.auth.onAuthStateChange((_event, session) =>
      setToken(session?.access_token ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  const leave = useCallback(
    (query: string) => {
      if (redirected.current) return;
      redirected.current = true;
      setRefused(true);
      write(DEV_TOKEN, null);
      router.replace(`/login${query}`);
    },
    [router],
  );

  useEffect(() => {
    if (token === null) router.replace('/login');
    if (!token) return;
    // Seule la réponse à la dernière demande compte (changement d'enseigne rapide A → B).
    const generation = ++meGeneration.current;
    const controller = new AbortController();
    api({ token, tenantId }, '/me', meSchema, { signal: controller.signal })
      .then((next) => {
        if (generation !== meGeneration.current) return;
        setMe(next);
        setMeError(null);
        setResolving(false);
      })
      .catch((e: unknown) => {
        if (generation !== meGeneration.current || controller.signal.aborted) return;
        setResolving(false);
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) leave('?refus=1');
        else setMeError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [token, tenantId, router, leave, meAttempt]);

  const currentTenant = useRef<string | null>(null);
  currentTenant.current = tenantId;
  const setTenant = useCallback((id: string | null) => {
    write(TENANT, id);
    // Même enseigne : pas de nouvelle demande /me, donc rien à attendre.
    if (id === currentTenant.current) return;
    setResolving(true);
    setTenantId(id);
  }, []);

  const reportUnauthorized = useCallback(() => leave('?expire=1'), [leave]);

  const logout = useCallback(async () => {
    write(DEV_TOKEN, null);
    write(TENANT, null);
    await supabase()?.auth.signOut();
    setToken(null);
  }, []);

  const value = useMemo(
    () =>
      token && me
        ? {
            auth: { token, tenantId: resolving ? tenantId : (me.tenant?.id ?? tenantId) },
            me,
            ready: !resolving && !refused,
            setTenant,
            reportUnauthorized,
            logout,
          }
        : null,
    [token, me, tenantId, resolving, refused, setTenant, reportUnauthorized, logout],
  );
  if (!value && meError)
    return (
      <div className="center stack" role="alert">
        <p className="muted">
          {messages.admin.common.loadFailed} {meError}
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setMeError(null);
            setMeAttempt((n) => n + 1);
          }}
        >
          {messages.admin.common.retry}
        </button>
      </div>
    );
  if (!value) return <div className="center muted">…</div>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
