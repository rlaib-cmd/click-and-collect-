import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loyaltyMemberSchema,
  loyaltyProgramSchema,
  loyaltySessionSchema,
  otpStartResponseSchema,
  otpVerifyResponseSchema,
  type LoyaltyJoinRequest,
  type OtpChannel,
  type OtpStartResponse,
  type OtpVerifyRequest,
  type LoyaltyMemberDto,
  type LoyaltyProgramDto,
} from '@splash360/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiGet, apiPost, ApiRequestError } from '@/api/client';
import { useTenant } from '@/tenant/TenantProvider';

interface LoyaltyContextValue {
  /** undefined : programme en cours de chargement. */
  readonly program: LoyaltyProgramDto | undefined;
  readonly enabled: boolean;
  /** Jeton du membre connecté, conservé sur l'appareil ; null hors connexion. */
  readonly memberToken: string | null;
  readonly member: LoyaltyMemberDto | null;
  readonly memberLoading: boolean;
  readonly join: (input: LoyaltyJoinRequest) => Promise<void>;
  readonly login: (email: string) => Promise<void>;
  /** Connexion par code (lot 10) : envoi du code par SMS ou e-mail. */
  readonly startCode: (channel: OtpChannel, identifier: string) => Promise<OtpStartResponse>;
  /** Vérifie le code : session ouverte, ou prénom demandé pour créer le compte. */
  readonly verifyCode: (input: OtpVerifyRequest) => Promise<'connected' | 'needsName'>;
  readonly logout: () => void;
  readonly refresh: () => void;
}

const LoyaltyContext = createContext<LoyaltyContextValue | null>(null);

export function useLoyalty(): LoyaltyContextValue {
  const value = useContext(LoyaltyContext);
  if (!value) throw new Error('useLoyalty doit être utilisé sous <LoyaltyProvider>');
  return value;
}

const storageKey = (subdomain: string) => `splash360:fidelite:${subdomain}`;

/** Club fidélité de l'enseigne : programme, compte du client et ses points (lot 8). */
export function LoyaltyProvider({ children }: { children: ReactNode }) {
  const { config } = useTenant();
  const sub = config.tenant.subdomain;
  const client = useQueryClient();
  const [memberToken, setMemberToken] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(storageKey(sub))
      .then((t) => setMemberToken(t))
      .catch(() => undefined)
      .finally(() => setRestored(true));
  }, [sub]);

  const program = useQuery({
    queryKey: ['loyalty-program', sub],
    queryFn: () => apiGet(`/v1/tenants/${sub}/loyalty/program`, loyaltyProgramSchema),
    staleTime: 5 * 60_000,
  });

  const member = useQuery({
    queryKey: ['loyalty-me', sub, memberToken],
    queryFn: () =>
      apiGet(`/v1/tenants/${sub}/loyalty/me`, loyaltyMemberSchema, (input, init) =>
        fetch(input, { ...init, headers: { Authorization: `Bearer ${memberToken ?? ''}` } }),
      ),
    enabled: memberToken !== null && program.data?.enabled === true,
    refetchOnWindowFocus: true,
    retry: (count, error) =>
      !(error instanceof ApiRequestError && error.status === 401) && count < 2,
  });

  const store = useCallback(
    (token: string | null) => {
      setMemberToken(token);
      const op = token
        ? AsyncStorage.setItem(storageKey(sub), token)
        : AsyncStorage.removeItem(storageKey(sub));
      op.catch(() => undefined);
    },
    [sub],
  );

  // Jeton refusé par le serveur : on se déconnecte proprement.
  useEffect(() => {
    if (member.error instanceof ApiRequestError && member.error.status === 401) store(null);
  }, [member.error, store]);

  const sessionMutation = useMutation({
    mutationFn: (req: { path: 'join' | 'login'; body: unknown }) =>
      apiPost(`/v1/tenants/${sub}/loyalty/${req.path}`, req.body, loyaltySessionSchema),
    onSuccess: (session) => {
      client.setQueryData(['loyalty-me', sub, session.memberToken], session.member);
      store(session.memberToken);
    },
  });

  const value = useMemo<LoyaltyContextValue>(
    () => ({
      program: program.data,
      enabled: program.data?.enabled === true,
      memberToken: restored ? memberToken : null,
      member: memberToken ? (member.data ?? null) : null,
      memberLoading: !restored || (memberToken !== null && member.isPending),
      join: async (input) => {
        await sessionMutation.mutateAsync({ path: 'join', body: input });
      },
      login: async (email) => {
        await sessionMutation.mutateAsync({ path: 'login', body: { email } });
      },
      startCode: (channel, identifier) =>
        apiPost(
          `/v1/tenants/${sub}/loyalty/otp/start`,
          { channel, identifier },
          otpStartResponseSchema,
        ),
      verifyCode: async (input) => {
        const r = await apiPost(
          `/v1/tenants/${sub}/loyalty/otp/verify`,
          input,
          otpVerifyResponseSchema,
        );
        if ('needsName' in r) return 'needsName';
        client.setQueryData(['loyalty-me', sub, r.memberToken], r.member);
        store(r.memberToken);
        return 'connected';
      },
      logout: () => store(null),
      refresh: () => void member.refetch(),
    }),
    [program.data, restored, memberToken, member, sessionMutation, store, sub, client],
  );

  return <LoyaltyContext.Provider value={value}>{children}</LoyaltyContext.Provider>;
}
