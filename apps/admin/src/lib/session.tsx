'use client';

import { meSchema, type Me } from '@splash360/contracts';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  setTenant(id: string | null): void;
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

  useEffect(() => {
    if (token === null) router.replace('/login');
    if (!token) return;
    api({ token, tenantId }, '/me', meSchema)
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          write(DEV_TOKEN, null);
          router.replace('/login?refus=1');
        }
      });
  }, [token, tenantId, router]);

  const setTenant = useCallback((id: string | null) => {
    write(TENANT, id);
    setTenantId(id);
  }, []);

  const logout = useCallback(async () => {
    write(DEV_TOKEN, null);
    write(TENANT, null);
    await supabase()?.auth.signOut();
    setToken(null);
  }, []);

  const value = useMemo(
    () =>
      token && me
        ? { auth: { token, tenantId: me.tenant?.id ?? tenantId }, me, setTenant, logout }
        : null,
    [token, me, tenantId, setTenant, logout],
  );
  if (!value) return <div className="center muted">…</div>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
