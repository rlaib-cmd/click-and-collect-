import {
  createRoutingLoyaltyProvider,
  createYoufidRegistry,
  noLoyaltyProvider,
  parseYoufidAccounts,
  youfidDeviceId,
  type LoyaltyProvider,
  type YoufidRegistry,
  type YoufidStore,
} from '@splash360/api-loyalty';
import type { TenantStore } from '@splash360/db';

/** Durée de cache du sous-domaine d'une enseigne (il ne change pas en pratique). */
const SUBDOMAIN_TTL_MS = 5 * 60_000;

/**
 * Fidélité du serveur (lot 21, ADR 0026) : YouFID pour les enseignes présentes dans
 * `YOUFID_ACCOUNTS` (clé : sous-domaine), `fallback` (démonstration ou rien) pour les autres.
 * Sans compte YouFID ni démonstration : pas de fidélité du tout (`loyalty` absent).
 */
export function configureLoyalty(options: {
  /** Fournisseur des enseignes sans YouFID ; null : aucune fidélité pour elles. */
  readonly fallback: LoyaltyProvider | null;
  readonly accountsJson: string | undefined;
  readonly baseUrl: string | undefined;
  readonly deviceId: string | undefined;
  readonly environment: string;
  readonly store: YoufidStore;
  readonly tenants: Pick<TenantStore, 'findById'>;
  readonly random: () => string;
  readonly log: (message: string, data?: Record<string, unknown>) => void;
  readonly fetch?: typeof fetch;
}): { readonly loyalty: LoyaltyProvider | null; readonly youfid: YoufidRegistry | null } {
  // Configuration illisible : YouFID désactivé, le reste de l'API démarre (erreur journalisée
  // sans citer les identifiants).
  let accounts: ReturnType<typeof parseYoufidAccounts>;
  try {
    accounts = parseYoufidAccounts(options.accountsJson);
  } catch (error) {
    options.log('Fidélité YouFID désactivée : configuration invalide', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { loyalty: options.fallback, youfid: null };
  }
  if (accounts.size === 0) return { loyalty: options.fallback, youfid: null };
  const registry = createYoufidRegistry({
    accounts,
    store: options.store,
    random: options.random,
    deviceId: youfidDeviceId(options.deviceId, options.environment),
    log: options.log,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  options.log('Fidélité YouFID configurée', { tenants: [...accounts.keys()] });
  const subdomains = new Map<string, { value: string | null; at: number }>();
  async function subdomainOf(tenantId: string): Promise<string | null> {
    const cached = subdomains.get(tenantId);
    if (cached && Date.now() - cached.at < SUBDOMAIN_TTL_MS) return cached.value;
    const value = (await options.tenants.findById(tenantId))?.subdomain ?? null;
    subdomains.set(tenantId, { value, at: Date.now() });
    return value;
  }
  return {
    loyalty: createRoutingLoyaltyProvider({
      resolve: async (tenant) => {
        const sub = await subdomainOf(tenant.id);
        return sub ? registry.providerFor(sub) : null;
      },
      fallback: options.fallback ?? noLoyaltyProvider,
    }),
    youfid: registry,
  };
}
