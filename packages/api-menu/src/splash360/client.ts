import { z } from 'zod';

/**
 * Client de l'API Click & Collect Splash360 (docs/api-splash360/openapi-click-collect-1.0.0.json).
 * Seul code qui appelle Splash360 (règle n° 5, ADR 0018) : la carte (`getMenus`) et la caisse
 * (`submitCommande`, `getCommandeStatus`, `submitPaiement`), et l'export des ventes (`listSales`).
 *
 * Authentification OAuth2 « client credentials » (consignes Splash360 du 25/11, ADR 0024) :
 * jeton demandé à `tokenUrl` (défaut https://api2.splash360.fr/oauth/v2/token) avec les
 * identifiants en en-tête `Authorization: Basic` et `scope=user`, valable 24 h ; gardé jusqu'à
 * 60 s avant son expiration, redemandé une fois si l'API répond 401.
 * Appels SÉQUENTIELS : Splash360 demande de ne jamais appeler en parallèle ; tous les échanges
 * d'un client (jeton, carte, caisse) passent par une seule file.
 * Les identifiants viennent de l'environnement du serveur, jamais de l'application.
 */
export interface Splash360Credentials {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** URL complète du jeton (défaut : api2.splash360.fr). */
  readonly tokenUrl?: string;
  /** Portée demandée (défaut « user »). */
  readonly scope?: string;
  /** Chemin de la carte (défaut /api/export/v2/menus). */
  readonly menuPath?: string;
  /**
   * Export des ventes (`/api/export/orders`, api2) : identifiants distincts possibles
   * (SPLASH360_ORDERS_CLIENT_ID / _SECRET), repli sur les identifiants principaux.
   */
  readonly ordersClientId?: string;
  /**
   * Carte (`/api/export/v2/menus`) : identifiants distincts possibles, fournis par Splash360
   * pour le restaurant (SPLASH360_MENU_CLIENT_ID / _SECRET), repli sur les identifiants principaux.
   */
  readonly menuClientId?: string;
  readonly menuClientSecret?: string;
  /** URL du jeton pour ces identifiants de carte (défaut : celle des identifiants principaux). */
  readonly menuTokenUrl?: string;
  /**
   * Envoi des identifiants de carte : en-tête Basic (défaut) ou dans le corps du formulaire
   * (client_id / client_secret), comme l'exige le client 4114 d'après Splash360.
   */
  readonly menuTokenAuth?: 'basic' | 'body';
  readonly ordersClientSecret?: string;
  /** Serveur de l'export des ventes (défaut https://api2.splash360.fr). */
  readonly ordersBaseUrl?: string;
}

export const SPLASH360_DEFAULT_TOKEN_URL = 'https://api2.splash360.fr/oauth/v2/token';
export const SPLASH360_DEFAULT_MENU_PATH = '/api/export/v2/menus';
export const SPLASH360_DEFAULT_ORDERS_URL = 'https://api2.splash360.fr';

/** Filtre de l'export des ventes (doc Postman SPLASH_ORDERS). Dates au format AAAA-MM-JJ. */
export interface Splash360SalesQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly status?: 'confirmed' | 'deleted' | 'confirmed,deleted';
  /** Première page = 1 (confirmé par Splash360 le 25/11). */
  readonly page?: number;
  /** 1 à 100 (maximum de l'API). */
  readonly pageSize?: number;
}

/**
 * Coordination entre instances du serveur (ADR 0024), fournie par `apps/api` (Postgres).
 * `clientKey` est une empreinte SHA-256 de l'identifiant client : jamais le secret.
 */
export interface Splash360Gate {
  /** Exécute `task` seul pour cet identifiant client, toutes instances confondues. */
  exclusive<T>(clientKey: string, task: () => Promise<T>): Promise<T>;
  /**
   * Réserve un appel d'export des ventes : 0 si l'appel est permis (et horodaté),
   * sinon le nombre de millisecondes à attendre.
   */
  reserveSales(clientKey: string, minIntervalMs: number): Promise<number>;
}

/** Splash360 : au plus un appel d'export des ventes par minute et par identifiant client. */
export const SPLASH360_SALES_MIN_INTERVAL_MS = 60_000;

export interface Splash360ClientOptions extends Splash360Credentials {
  readonly fetch?: typeof fetch;
  /** Sans `gate`, la file et la pause d'une minute ne valent que pour cette instance. */
  readonly gate?: Splash360Gate;
  /** Événement notable sans secret (ex. repli sur les identifiants principaux pour la carte). */
  readonly onNotice?: (message: string, detail?: Record<string, unknown>) => void;
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
    /** Attente imposée avant un nouvel essai (pause de l'export des ventes). */
    readonly retryAfterMs: number | null = null,
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
  /** Lecture brute d'une carte à un chemin donné (diagnostic super-admin, /api/export/ seulement). */
  getMenusAt(path: string): Promise<unknown>;
  submitCommande(commande: Splash360Commande): Promise<{ ticketId: string }>;
  /** Réponse brute de `cmdstatus` ; lue par `readCommandeStatus`. */
  getCommandeStatus(ticketId: string): Promise<unknown>;
  submitPaiement(ticketId: string, reglements: readonly Splash360Reglement[]): Promise<void>;
  /** Ventes brutes de la caisse (`/api/export/orders`) ; format de réponse encore inconnu. */
  listSales(query: Splash360SalesQuery): Promise<unknown>;
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

/** Durée de vie supposée d'un jeton quand l'API ne la donne pas (24 h, annoncée par Splash360). */
const DEFAULT_TOKEN_LIFETIME_S = 86_400;
const TOKEN_MARGIN_MS = 60_000;

export function createSplash360Client(options: Splash360ClientOptions): Splash360Client {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const base = options.baseUrl.replace(/\/+$/, '');
  const tokenUrl = options.tokenUrl?.trim() || SPLASH360_DEFAULT_TOKEN_URL;
  const scope = options.scope?.trim() || 'user';
  const menuPath = options.menuPath?.trim() || SPLASH360_DEFAULT_MENU_PATH;
  const gate = options.gate;
  // Une file par identifiant client : chaque échange (requête + lecture de la réponse) attend la
  // fin du précédent ; avec `gate`, l'exclusivité vaut aussi entre instances.
  const queues = new Map<string, Promise<unknown>>();
  const keys = new Map<string, Promise<string>>();
  const lastSales = new Map<string, number>();

  interface Reply {
    readonly status: number;
    readonly ok: boolean;
    readonly body: unknown;
  }

  function clientKey(clientId: string): Promise<string> {
    let key = keys.get(clientId);
    if (!key) {
      key = crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(`splash360:${clientId}`))
        .then((d) =>
          Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''),
        );
      keys.set(clientId, key);
    }
    return key;
  }

  function call(clientId: string, url: string, init: RequestInit): Promise<Reply> {
    const previous = queues.get(clientId) ?? Promise.resolve();
    const run = previous.then(async () => {
      if (!gate) return send(url, init);
      const key = await clientKey(clientId);
      return gate.exclusive(key, () => send(url, init)).catch(coordinationError);
    });
    queues.set(
      clientId,
      run.catch(() => undefined),
    );
    return run;
  }

  /** Panne du verrou ou de la base : réessayable, comme une panne de Splash360. */
  function coordinationError(error: unknown): never {
    if (error instanceof Splash360Error) throw error;
    throw new Splash360Error(
      `Coordination Splash360 indisponible : ${error instanceof Error ? error.message : String(error)}`,
      null,
      true,
    );
  }

  /** Pause d'une minute entre deux exports des ventes d'un même identifiant client. */
  async function reserveSales(clientId: string): Promise<void> {
    const key = await clientKey(clientId);
    let waitMs: number;
    if (gate) {
      waitMs = await gate
        .reserveSales(key, SPLASH360_SALES_MIN_INTERVAL_MS)
        .catch(coordinationError);
    } else {
      const last = lastSales.get(key);
      waitMs = last === undefined ? 0 : Math.max(0, last + SPLASH360_SALES_MIN_INTERVAL_MS - now());
      if (waitMs === 0) lastSales.set(key, now());
    }
    if (waitMs > 0) {
      throw new Splash360Error(
        'Splash360 : un seul export des ventes par minute',
        429,
        true,
        waitMs,
      );
    }
  }

  async function send(url: string, init: RequestInit): Promise<Reply> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new Splash360Error(
        `Splash360 injoignable : ${error instanceof Error ? error.message : String(error)}`,
        null,
        true,
      );
    }
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  }

  /** Jeton d'un couple d'identifiants, en cache ; une seule demande à la fois. */
  interface TokenSource {
    readonly clientId: string;
    get(): Promise<string>;
    reset(): void;
  }

  /** Code d'erreur OAuth (« invalid_client », « invalid_scope »…), jamais d'identifiant. */
  function oauthReason(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    const { error, error_description: description } = body as Record<string, unknown>;
    const parts = [error, description]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.slice(0, 120));
    return parts.length ? ` : ${parts.join(' — ')}` : '';
  }

  function tokenSource(
    clientId: string,
    clientSecret: string,
    url: string = tokenUrl,
    auth: 'basic' | 'body' = 'basic',
  ): TokenSource {
    let token: { value: string; expiresAt: number } | null = null;
    let pending: Promise<string> | null = null;

    async function fetchToken(): Promise<string> {
      const form = new URLSearchParams({ grant_type: 'client_credentials', scope });
      if (auth === 'body') {
        form.set('client_id', clientId);
        form.set('client_secret', clientSecret);
      }
      const res = await call(clientId, url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          ...(auth === 'basic'
            ? { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` }
            : {}),
        },
        body: form.toString(),
      });
      if (!res.ok) {
        // 400/401 : identifiants refusés, inutile d'insister ; 5xx : panne passagère.
        throw new Splash360Error(
          `Jeton Splash360 refusé (HTTP ${res.status}${oauthReason(res.body)})`,
          res.status,
          res.status >= 500,
        );
      }
      const parsed = tokenResponse.safeParse(res.body);
      if (!parsed.success) throw new Splash360Error('Jeton Splash360 illisible', res.status, true);
      const lifetime = (parsed.data.expires_in ?? DEFAULT_TOKEN_LIFETIME_S) * 1000;
      token = { value: parsed.data.access_token, expiresAt: now() + lifetime - TOKEN_MARGIN_MS };
      return token.value;
    }

    return {
      clientId,
      get() {
        if (token && token.expiresAt > now()) return Promise.resolve(token.value);
        pending ??= fetchToken().finally(() => {
          pending = null;
        });
        return pending;
      },
      reset() {
        token = null;
      },
    };
  }

  const mainToken = tokenSource(options.clientId, options.clientSecret);
  const ordersClientId = options.ordersClientId?.trim();
  const ordersClientSecret = options.ordersClientSecret?.trim();
  const ordersToken =
    ordersClientId && ordersClientSecret
      ? tokenSource(ordersClientId, ordersClientSecret)
      : mainToken;
  const menuClientId = options.menuClientId?.trim();
  const menuClientSecret = options.menuClientSecret?.trim();
  const menuToken =
    menuClientId && menuClientSecret
      ? tokenSource(
          menuClientId,
          menuClientSecret,
          options.menuTokenUrl?.trim() || tokenUrl,
          options.menuTokenAuth ?? 'basic',
        )
      : mainToken;
  /**
   * Lecture de la carte : identifiants dédiés s'ils sont posés ; si Splash360 les refuse
   * (jeton 400/401), repli sur les identifiants principaux pour que la carte reste servie.
   */
  async function menuCall(path: string): Promise<unknown> {
    if (menuToken === mainToken) return authorized(path, {}, mainToken);
    try {
      return await authorized(path, {}, menuToken);
    } catch (error) {
      const refused =
        error instanceof Splash360Error && (error.status === 400 || error.status === 401);
      if (!refused) throw error;
      options.onNotice?.('Identifiants de carte Splash360 refusés : repli sur les principaux', {
        status: error.status,
        reason: error.message,
      });
      return authorized(path, {}, mainToken);
    }
  }
  const ordersBase = (options.ordersBaseUrl?.trim() || SPLASH360_DEFAULT_ORDERS_URL).replace(
    /\/+$/,
    '',
  );

  async function authorized(
    path: string,
    init: RequestInit = {},
    source: TokenSource = mainToken,
    server: string = base,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const value = await source.get();
      const res = await call(source.clientId, `${server}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${value}`,
        },
      });
      if (res.status === 401 && attempt === 0) {
        source.reset(); // jeton révoqué ou expiré plus tôt que prévu : on en redemande un
        continue;
      }
      const body = res.body;
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
    getMenus: () => menuCall(menuPath),
    getMenusAt: (path) => {
      if (!/^\/api\/export\/[a-z0-9/_-]+$/i.test(path)) {
        return Promise.reject(new Splash360Error('Chemin de carte refusé', null, false));
      }
      return menuCall(path);
    },

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

    async listSales(query) {
      const date = /^\d{4}-\d{2}-\d{2}$/;
      const pageSize = query.pageSize ?? 100;
      // Pages numérotées à partir de 0 (constaté le 25/11 : page=1 est la deuxième page).
      const page = query.page ?? 0;
      if (
        !date.test(query.fromDate) ||
        !date.test(query.toDate) ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100 ||
        !Number.isInteger(page) ||
        page < 0
      ) {
        throw new Splash360Error('Filtre des ventes invalide', null, false);
      }
      await reserveSales(ordersToken.clientId);
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        fromDate: query.fromDate,
        toDate: query.toDate,
        status: query.status ?? 'confirmed',
      });
      return authorized(`/api/export/orders?${params.toString()}`, {}, ordersToken, ordersBase);
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
  const optional = (name: string) => get(name)?.trim() || undefined;
  const tokenUrl = optional('SPLASH360_TOKEN_URL');
  const scope = optional('SPLASH360_SCOPE');
  const menuPath = optional('SPLASH360_MENU_PATH');
  const ordersClientId = optional('SPLASH360_ORDERS_CLIENT_ID');
  const ordersClientSecret = optional('SPLASH360_ORDERS_CLIENT_SECRET');
  const ordersBaseUrl = optional('SPLASH360_ORDERS_API_URL');
  const menuClientId = optional('SPLASH360_MENU_CLIENT_ID');
  const menuClientSecret = optional('SPLASH360_MENU_CLIENT_SECRET');
  const menuTokenUrl = optional('SPLASH360_MENU_TOKEN_URL');
  const menuTokenAuth = optional('SPLASH360_MENU_TOKEN_AUTH');
  return {
    baseUrl: optional('SPLASH360_API_URL') ?? 'https://api.splash360.fr',
    clientId,
    clientSecret,
    ...(tokenUrl ? { tokenUrl } : {}),
    ...(scope ? { scope } : {}),
    ...(menuPath ? { menuPath } : {}),
    ...(ordersClientId && ordersClientSecret ? { ordersClientId, ordersClientSecret } : {}),
    ...(ordersBaseUrl ? { ordersBaseUrl } : {}),
    ...(menuClientId && menuClientSecret ? { menuClientId, menuClientSecret } : {}),
    ...(menuTokenUrl ? { menuTokenUrl } : {}),
    ...(menuTokenAuth === 'body' || menuTokenAuth === 'basic' ? { menuTokenAuth } : {}),
  };
}
