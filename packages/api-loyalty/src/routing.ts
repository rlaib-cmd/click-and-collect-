import type { LoyaltyProvider, LoyaltyTenant } from './provider';
import { createYoufidClient, type YoufidClient, type YoufidCredentials } from './youfid/client';
import { createYoufidLoyaltyProvider } from './youfid/provider';
import type { YoufidStore } from './youfid/store';

/** Aucune fidélité : `getProgram` renvoie null, les autres appels n'arrivent jamais. */
export const noLoyaltyProvider: LoyaltyProvider = {
  getProgram: () => Promise.resolve(null),
  join: () => Promise.reject(new Error('Pas de programme de fidélité')),
  findByEmail: () => Promise.resolve(null),
  findByPhone: () => Promise.resolve(null),
  getMember: () => Promise.resolve(null),
  updateProfile: () => Promise.resolve({ ok: false, error: 'unknown_member' }),
  history: () => Promise.resolve([]),
  settleOrder: () => Promise.resolve({ ok: false, error: 'unknown_member' }),
  listMembers: () => Promise.resolve([]),
  adjustPoints: () => Promise.resolve({ ok: false, error: 'unknown_member' }),
  deleteMember: () => Promise.resolve(false),
};

/**
 * Fournisseur par enseigne (lot 21) : YouFID pour les enseignes configurées, `fallback`
 * (démonstration ou aucune fidélité) pour les autres.
 */
export function createRoutingLoyaltyProvider(options: {
  readonly resolve: (tenant: LoyaltyTenant) => Promise<LoyaltyProvider | null>;
  readonly fallback: LoyaltyProvider;
}): LoyaltyProvider {
  const pick = async (t: LoyaltyTenant) => (await options.resolve(t)) ?? options.fallback;
  return {
    getProgram: async (t) => (await pick(t)).getProgram(t),
    join: async (t, i) => (await pick(t)).join(t, i),
    findByEmail: async (t, e) => (await pick(t)).findByEmail(t, e),
    findByPhone: async (t, p) => (await pick(t)).findByPhone(t, p),
    getMember: async (t, m) => (await pick(t)).getMember(t, m),
    updateProfile: async (t, m, i) => (await pick(t)).updateProfile(t, m, i),
    history: async (t, m) => (await pick(t)).history(t, m),
    settleOrder: async (t, s) => (await pick(t)).settleOrder(t, s),
    listMembers: async (t, s, l) => (await pick(t)).listMembers(t, s, l),
    adjustPoints: async (t, m, d, l, o) => (await pick(t)).adjustPoints(t, m, d, l, o),
    deleteMember: async (t, m) => (await pick(t)).deleteMember(t, m),
  };
}

export interface YoufidProbeResult {
  readonly merchantId: number;
  readonly secType: string;
  readonly rewards: number;
  /** Diagnostic : le marchand et ses cadeaux tels que YouFID les décrit (aucune donnée client). */
  readonly merchantName: string | null;
  readonly programName: string | null;
  readonly pointsOnAmount: boolean;
  readonly catalog: readonly {
    readonly id: string;
    readonly name: string;
    readonly cost: number;
    readonly type: string | null;
  }[];
}

/** Comptes YouFID du serveur, un client (et une session) par enseigne, créés à la demande. */
export interface YoufidRegistry {
  has(subdomain: string): boolean;
  providerFor(subdomain: string): LoyaltyProvider | null;
  /** Diagnostic : connexion (route 1) puis détails du marchand (route 2), sans secret. */
  probe(subdomain: string): Promise<YoufidProbeResult> | null;
}

export function createYoufidRegistry(options: {
  readonly accounts: ReadonlyMap<string, YoufidCredentials>;
  readonly store: YoufidStore;
  readonly random: () => string;
  readonly baseUrl?: string;
  readonly deviceId?: string;
  readonly fetch?: typeof fetch;
  readonly log?: (message: string, data?: Record<string, unknown>) => void;
}): YoufidRegistry {
  const entries = new Map<string, { client: YoufidClient; provider: LoyaltyProvider }>();
  function entry(subdomain: string) {
    const existing = entries.get(subdomain);
    if (existing) return existing;
    const credentials = options.accounts.get(subdomain);
    if (!credentials) return null;
    const client = createYoufidClient({
      ...credentials,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const provider = createYoufidLoyaltyProvider({
      client,
      store: options.store,
      random: options.random,
      ...(options.log ? { log: options.log } : {}),
    });
    const created = { client, provider };
    entries.set(subdomain, created);
    return created;
  }
  return {
    has: (subdomain) => options.accounts.has(subdomain),
    providerFor: (subdomain) => entry(subdomain)?.provider ?? null,
    probe(subdomain) {
      const e = entry(subdomain);
      if (!e) return null;
      return (async () => {
        const session = await e.client.session();
        const merchant = await e.client.merchantDetails();
        return {
          merchantId: session.merchantId,
          secType: session.secType,
          rewards: merchant.products.length,
          merchantName: merchant.name,
          programName: merchant.programName,
          pointsOnAmount: merchant.pointsOnAmount,
          catalog: merchant.products.map((p) => ({
            id: p.id,
            name: p.name,
            cost: p.cost,
            type: p.type,
          })),
        };
      })();
    },
  };
}
