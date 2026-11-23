import { z } from 'zod';

/**
 * Client de l'API Click & Collect Splash360 (docs/api-splash360/openapi-click-collect-1.0.0.json).
 * Seul code qui appelle Splash360 (règle n° 5, ADR 0018) : la carte (`getMenus`) et la caisse
 * (`submitCommande`, `getCommandeStatus`, `submitPaiement`).
 *
 * Authentification OAuth2 « client credentials » : jeton demandé à `/oauth/v2/token`,
 * gardé jusqu'à 60 s avant son expiration, redemandé une fois si l'API répond 401.
 * Les identifiants viennent de l'environnement du serveur, jamais de l'application.
 */
export interface Splash360Credentials {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface Splash360ClientOptions extends Splash360Credentials {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Délai maximal d'une requête (défaut 10 s). */
  readonly timeoutMs?: number;
}

/** Erreur d'appel à Splash360. `retryable` : panne ou surcharge, on peut réessayer plus tard. */
export class Splash360Error extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'Splash360Error';
  }
}

/** Ligne de commande au format Splash360 (`submitcommande`). Montants en euros, comme l'API. */
export interface Splash360CommandeItem {
  readonly itemid: number;
  readonly produitid: string;
  readonly quantite: number;
  readonly price: number;
  readonly ingredients: readonly { ingredient: string; qte: number; price: number }[];
}

export interface Splash360Commande {
  readonly provider: string;
  readonly mode: 'surplace' | 'emporter' | 'livraison';
  readonly status: 'standby';
  readonly total: number;
  readonly orderNumber: string;
  readonly items: readonly Splash360CommandeItem[];
  readonly comments: readonly (readonly { id: number; itemid?: number; text: string }[])[];
  readonly client: {
    readonly nom: string;
    readonly prenom: string;
    readonly telephone: string;
    readonly email?: string;
    readonly adresse?: string;
    readonly adresse2?: string;
    readonly codepostal?: string;
    readonly ville?: string;
    readonly commentaire?: string;
    readonly mode: string;
  };
  readonly modificateurs: readonly {
    type: 'discount' | 'frais';
    valeur: string;
    nom: string;
    taux?: number;
    item?: number;
  }[];
  readonly paymentType?: 'carte' | 'especes' | 'cheque' | 'ticket' | 'desk';
}

export interface Splash360Reglement {
  readonly type: 'carte' | 'especes' | 'cheque' | 'ticket';
  readonly valeur: number;
  readonly detail?: string;
}

export interface Splash360Client {
  /** Carte brute ; la traduction vers les types internes est faite par `toMenu`. */
  getMenus(): Promise<unknown>;
  submitCommande(commande: Splash360Commande): Promise<{ ticketId: string }>;
  /** Réponse brute de `cmdstatus` ; lue par `readCommandeStatus`. */
  getCommandeStatus(ticketId: string): Promise<unknown>;
  submitPaiement(ticketId: string, reglements: readonly Splash360Reglement[]): Promise<void>;
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional(),
});

const submitResponse = z.object({
  status: z.string().optional(),
  ticketId: z.union([z.string(), z.number()]).optional(),
  error_message: z.string().optional(),
});

/** Durée de vie supposée d'un jeton quand l'API ne la donne pas (1 h, valeur de FOSOAuthServer). */
const DEFAULT_TOKEN_LIFETIME_S = 3600;
const TOKEN_MARGIN_MS = 60_000;

export function createSplash360Client(options: Splash360ClientOptions): Splash360Client {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const base = options.baseUrl.replace(/\/+$/, '');
  let token: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new Splash360Error(
        `Splash360 injoignable : ${error instanceof Error ? error.message : String(error)}`,
        null,
        true,
      );
    }
  }

  async function fetchToken(): Promise<string> {
    const res = await call(`${base}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      // 400/401 : identifiants refusés, inutile d'insister ; 5xx : panne passagère.
      throw new Splash360Error(
        `Jeton Splash360 refusé (HTTP ${res.status})`,
        res.status,
        res.status >= 500,
      );
    }
    const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Splash360Error('Jeton Splash360 illisible', res.status, true);
    const lifetime = (parsed.data.expires_in ?? DEFAULT_TOKEN_LIFETIME_S) * 1000;
    token = { value: parsed.data.access_token, expiresAt: now() + lifetime - TOKEN_MARGIN_MS };
    return token.value;
  }

  function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return Promise.resolve(token.value);
    // Une seule demande de jeton à la fois, même si plusieurs appels partent ensemble.
    pending ??= fetchToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function authorized(path: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const value = await accessToken();
      const res = await call(`${base}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${value}`,
        },
      });
      if (res.status === 401 && attempt === 0) {
        token = null; // jeton révoqué ou expiré plus tôt que prévu : on en redemande un
        continue;
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = submitResponse.safeParse(body).data?.error_message;
        throw new Splash360Error(
          `Splash360 ${path} : HTTP ${res.status}${message ? ` (${message})` : ''}`,
          res.status,
          res.status >= 500 || res.status === 429,
        );
      }
      return body;
    }
    throw new Splash360Error('Splash360 : authentification refusée', 401, false);
  }

  function checkSuccess(path: string, body: unknown) {
    const parsed = submitResponse.safeParse(body);
    if (parsed.success && parsed.data.status === 'error') {
      throw new Splash360Error(
        `Splash360 ${path} refusé${parsed.data.error_message ? ` : ${parsed.data.error_message}` : ''}`,
        200,
        false,
      );
    }
    return parsed.data;
  }

  return {
    getMenus: () => authorized('/api/export/menus'),

    async submitCommande(commande) {
      const path = '/api/import/submitcommande';
      const body = await authorized(path, { method: 'POST', body: JSON.stringify(commande) });
      const ticketId = checkSuccess(path, body)?.ticketId;
      if (ticketId === undefined || String(ticketId).length === 0) {
        throw new Splash360Error('Splash360 : ticketId absent de la réponse', 200, false);
      }
      return { ticketId: String(ticketId) };
    },

    getCommandeStatus: (ticketId) =>
      authorized(`/api/export/cmdstatus/${encodeURIComponent(ticketId)}`),

    async submitPaiement(ticketId, reglements) {
      const path = `/api/import/submitcmdpaiement/${encodeURIComponent(ticketId)}`;
      const body = await authorized(path, {
        method: 'POST',
        body: JSON.stringify({ reglements }),
      });
      checkSuccess(path, body);
    },
  };
}

/** Lit les identifiants dans l'environnement ; null si l'un d'eux manque (caisse de démonstration). */
export function splash360CredentialsFrom(
  get: (name: string) => string | undefined,
): Splash360Credentials | null {
  const clientId = get('SPLASH360_CLIENT_ID')?.trim();
  const clientSecret = get('SPLASH360_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    baseUrl: get('SPLASH360_API_URL')?.trim() || 'https://api.splash360.fr',
    clientId,
    clientSecret,
  };
}
