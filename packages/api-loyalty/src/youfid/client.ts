import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decodeSessionKey, youfidAuthorization } from './signature';

/**
 * Client de l'API fidélité YouFID (« SPLASH FID POS API », docs/api-splash360/fidelite-youfid.md).
 * Seul code qui appelle cette API (ADR 0026). Toutes les routes sont des POST JSON ; la réponse
 * est toujours lue par son champ `status` (« ok »/« success » ou « error »/« ko »), quel que
 * soit le statut HTTP.
 *
 * Routes utilisées, et elles seules (consigne de Splash360 : certaines routes sont réservées au
 * marchand) : 1, 2, 3, 5, 6, 7, 10 et 12. Les routes 11 (consentement SMS), 13 (code PIN),
 * 14 et 15 (bons) ne sont pas implémentées.
 *
 * Données sensibles : les routes 3 et 5 renvoient le code PIN du client en clair. Les schémas
 * ci-dessous ne gardent que les champs déclarés : le PIN est retiré à la lecture et n'existe dans
 * aucun objet renvoyé. Aucun corps de requête ou de réponse n'est journalisé.
 */
export const YOUFID_DEFAULT_BASE_URL = 'https://api-loyalty.splash360.fr/dev/service/';

/** Durée d'attente maximale d'un appel. */
export const YOUFID_TIMEOUT_MS = 10_000;

/** Réinitialisation de la session avant son expiration (marge). */
const SESSION_MARGIN_MS = 10 * 60_000;

export type YoufidErrorKind =
  /** Refus explicite de l'API (`status` = error) : la requête n'a pas été appliquée. */
  | 'api'
  /** Connexion du marchand refusée, ou ERR0401 persistant après réinitialisation. */
  | 'auth'
  /** Réseau coupé ou délai dépassé : on ne sait pas si l'API a appliqué la requête. */
  | 'network'
  /** Réponse illisible (HTML, JSON tronqué) : issue inconnue elle aussi. */
  | 'invalid_response';

export class YoufidError extends Error {
  constructor(
    message: string,
    readonly kind: YoufidErrorKind,
    /** Code renvoyé par l'API (ERR0401, voucher-expired…), sinon null. */
    readonly code: string | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'YoufidError';
  }

  /** Issue inconnue : la requête a pu être appliquée par YouFID. */
  get uncertain(): boolean {
    return this.kind === 'network' || this.kind === 'invalid_response';
  }
}

export interface YoufidCredentials {
  readonly login: string;
  readonly password: string;
}

export interface YoufidClientOptions extends YoufidCredentials {
  readonly baseUrl?: string;
  /** Identifiant stable de l'appareil (100 caractères au plus) : clé propre, expirant en 48 h. */
  readonly deviceId?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Générateur de nonce (défaut : 16 octets aléatoires en hexadécimal). */
  readonly nonce?: () => string;
  readonly timeoutMs?: number;
  /**
   * Format du téléphone envoyé à YouFID. Défaut « national » (06…), celui saisi sur la tablette
   * en magasin ; à confirmer avec Splash360 (questions-en-attente, YouFID Y10).
   */
  readonly phoneFormat?: 'national' | 'e164';
}

// ——— Lecture tolérante des types (le serveur PHP renvoie parfois des nombres en texte) ———

const int = z
  .union([
    z.number().int(),
    z
      .string()
      .trim()
      .regex(/^-?\d+$/),
  ])
  .transform((v) => Number(v));
const id = z.union([z.number(), z.string().min(1)]).transform((v) => String(v));
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));
const flag = z
  .union([z.boolean(), z.number(), z.string()])
  .nullish()
  .transform((v) => v === true || v === 1 || v === '1');
const optin = z
  .union([z.boolean(), z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
    return null;
  });

const profileQuestion = z
  .object({
    id,
    type: z.string(),
    name: text,
    label: text,
    rank: text,
  })
  .nullish()
  .catch(null)
  .transform((q) => q ?? null);

const envelope = z.object({
  status: z.string(),
  message: text,
  code: text,
});

const initResponse = z.object({
  merchant_id: int,
  loyalty_mode: text,
  sec_type: z.string(),
  session_key: text,
  session_key_expires_at: text,
  session_key_expires_in: int.nullish(),
});

const merchantDetails = z.object({
  name: text,
  address: text,
  attribution_pts: text,
  products: z
    .array(z.object({ id, cost: int, name: z.string(), type: text }))
    .nullish()
    .catch([])
    .transform((p) => p ?? []),
  loyalty_program: z
    .object({ id: id.nullish(), name: text, program_type: text, validity: text })
    .nullish()
    .catch(null)
    .transform((p) => p ?? null),
});

const customer = z.object({
  usr_id: id,
  qr_code: z.union([z.string(), z.number()]).transform((v) => String(v)),
  nom: text,
  prenom: text,
  phone: text,
  sms_optin: optin,
  profile_question: profileQuestion,
  total_points: int.nullish().transform((v) => v ?? 0),
});

const scanResponse = z.object({
  usr_id: id.nullish(),
  won_pts: int.nullish().transform((v) => v ?? 0),
  total_pts: int.nullish(),
  fid_status: text,
  maximum_scans_reached: flag,
});

const transformResponse = z.object({ total_pts: int.nullish() });

const listUsersResponse = z.object({
  users: z
    .array(
      z.object({
        usr_id: id,
        first_name: text,
        last_name: text,
        email: text,
        qr_code: z.union([z.string(), z.number()]).transform((v) => String(v)),
      }),
    )
    .nullish()
    .transform((u) => u ?? []),
});

const registerResponse = z.object({
  usr_id: id,
  qr_code: z.union([z.string(), z.number()]).transform((v) => String(v)),
  phone: text,
  total_points: int.nullish().transform((v) => v ?? 0),
  sms_optin: optin,
  profile_question: profileQuestion,
});

// ——— Types publics, sans PIN ———

export interface YoufidSession {
  readonly merchantId: number;
  readonly secType: string;
  readonly loyaltyMode: string | null;
  /** Expiration de la clé (ms) ; null : clé fixe du marchand, sans expiration. */
  readonly expiresAt: number | null;
}

export interface YoufidProfileQuestion {
  readonly id: string;
  readonly type: string;
}

export interface YoufidMerchant {
  readonly name: string | null;
  /** « 1 » : points au montant ; « 0 » : points au passage. */
  readonly pointsOnAmount: boolean;
  readonly products: readonly {
    readonly id: string;
    readonly cost: number;
    readonly name: string;
    readonly type: string | null;
  }[];
  readonly programName: string | null;
}

export interface YoufidCustomer {
  readonly usrId: string;
  readonly qrCode: string;
  readonly lastName: string | null;
  readonly firstName: string | null;
  readonly phone: string | null;
  readonly smsOptin: boolean | null;
  readonly profileQuestion: YoufidProfileQuestion | null;
  readonly totalPoints: number;
}

export interface YoufidScanResult {
  readonly usrId: string | null;
  readonly wonPoints: number;
  readonly totalPoints: number | null;
  readonly maximumScansReached: boolean;
}

export interface YoufidRegistration {
  readonly usrId: string;
  readonly qrCode: string;
  /** Renvoyé pour un client existant seulement : sa présence indique un compte déjà connu. */
  readonly existing: boolean;
  readonly totalPoints: number;
  readonly smsOptin: boolean | null;
  readonly profileQuestion: YoufidProfileQuestion | null;
}

export interface YoufidListedUser {
  readonly usrId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly qrCode: string;
}

export type ProfileQuestionType = 'NAME' | 'EMAIL' | 'BIRTH';

export interface YoufidClient {
  /** Route 1 : connexion du marchand (session mise en cache). */
  session(): Promise<YoufidSession>;
  /** Route 2 : détails du marchand et cadeaux (`categories` n'est pas lu : toujours vide). */
  merchantDetails(): Promise<YoufidMerchant>;
  /** Route 3 : client par QR code ou par e-mail ; null s'il n'existe pas. */
  findCustomer(
    by: { readonly qrCode: string } | { readonly email: string },
  ): Promise<YoufidCustomer | null>;
  /**
   * Route 5 : passage client. `amountCents` (converti en euros exacts) ou `forcedPoints`
   * (crédit tel quel, positif). L'API n'a pas de clé d'idempotence : voir le registre local.
   */
  scan(input: {
    readonly qrCode: string;
    readonly usrId: string;
    readonly amountCents?: number;
    readonly forcedPoints?: number;
  }): Promise<YoufidScanResult>;
  /** Route 6 : points transformés en cadeau ; renvoie le solde restant. */
  transformToPresent(
    usrId: string,
    products: readonly { readonly id: string; readonly cost: number; readonly name: string }[],
  ): Promise<{ readonly totalPoints: number | null }>;
  /** Route 7 : recherche sur le nom, le prénom et l'e-mail (pas le téléphone). */
  listUsers(search: string, extendsSearch?: boolean): Promise<readonly YoufidListedUser[]>;
  /** Route 10 : client retrouvé par téléphone (E.164), ou créé avec un QR code et 0 point. */
  registerByPhone(phoneE164: string): Promise<YoufidRegistration>;
  /** Route 12 : réponse à une question de profil (répond « success »). */
  submitProfileResponse(
    usrId: string,
    question: { readonly id: string; readonly type: ProfileQuestionType },
    response: string,
  ): Promise<void>;
}

/** Centimes (entiers) → euros décimaux exacts (1234 → 12.34), sans calcul à virgule. */
export function centsToEuros(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Montant invalide');
  const units = Math.floor(cents / 100);
  const rest = cents % 100;
  return Number(`${String(units)}.${String(rest).padStart(2, '0')}`);
}

/** +33612345678 → 0612345678 (format national) ; autre indicatif : inchangé. */
export function youfidPhone(e164: string, format: 'national' | 'e164'): string {
  if (format === 'national' && /^\+33[1-9]\d{8}$/.test(e164)) return `0${e164.slice(3)}`;
  return e164;
}

const numericId = (v: string): number | string => (/^\d{1,15}$/.test(v) ? Number(v) : v);

interface CachedSession extends YoufidSession {
  readonly key: Buffer | null;
}

export function createYoufidClient(options: YoufidClientOptions): YoufidClient {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const nonce = options.nonce ?? (() => randomBytes(16).toString('hex'));
  const timeoutMs = options.timeoutMs ?? YOUFID_TIMEOUT_MS;
  const phoneFormat = options.phoneFormat ?? 'national';
  const base = (options.baseUrl?.trim() || YOUFID_DEFAULT_BASE_URL).replace(/\/*$/, '/');
  let current: CachedSession | null = null;
  let pending: Promise<CachedSession> | null = null;

  async function post(
    route: string,
    body: string,
    authorization: string | null,
  ): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${route}.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Message fixe : ni corps, ni identifiants dans l'erreur.
      throw new YoufidError(`YouFID injoignable (${route})`, 'network');
    }
    let raw: string;
    try {
      raw = await res.text();
    } catch {
      throw new YoufidError(`Réponse YouFID interrompue (${route})`, 'network', null, res.status);
    }
    try {
      return { status: res.status, json: JSON.parse(raw) as unknown };
    } catch {
      throw new YoufidError(
        `Réponse YouFID illisible (${route})`,
        'invalid_response',
        null,
        res.status,
      );
    }
  }

  async function init(): Promise<CachedSession> {
    const body = JSON.stringify({
      login: options.login,
      password: options.password,
      ...(options.deviceId ? { device_id: options.deviceId } : {}),
    });
    const { status, json } = await post('marchandInitMarchand', body, null);
    const env = envelope.safeParse(json);
    if (!env.success) {
      throw new YoufidError(
        'Connexion YouFID : réponse inattendue',
        'invalid_response',
        null,
        status,
      );
    }
    if (env.data.status !== 'ok') {
      throw new YoufidError('Connexion du marchand YouFID refusée', 'auth', env.data.code, status);
    }
    const parsed = initResponse.safeParse(json);
    if (!parsed.success) {
      throw new YoufidError(
        'Connexion YouFID : réponse incomplète',
        'invalid_response',
        null,
        status,
      );
    }
    const r = parsed.data;
    const signed = r.sec_type === 'oauth1HmacSha256';
    if (signed && !r.session_key) {
      throw new YoufidError('Connexion YouFID : clé de session absente', 'invalid_response');
    }
    const received = now();
    let expiresAt: number | null = null;
    if (typeof r.session_key_expires_in === 'number' && r.session_key_expires_in > 0) {
      expiresAt = received + r.session_key_expires_in * 1000;
    } else if (r.session_key_expires_at) {
      const at = Date.parse(r.session_key_expires_at);
      expiresAt = Number.isFinite(at) ? at : null;
    }
    return {
      merchantId: r.merchant_id,
      secType: r.sec_type,
      loyaltyMode: r.loyalty_mode,
      expiresAt,
      key: signed && r.session_key ? decodeSessionKey(r.session_key) : null,
    };
  }

  async function session(fresh = false): Promise<CachedSession> {
    if (fresh) current = null;
    if (current && (current.expiresAt === null || current.expiresAt - SESSION_MARGIN_MS > now())) {
      return current;
    }
    // Une seule initialisation à la fois pour cette instance.
    pending ??= init().finally(() => {
      pending = null;
    });
    current = await pending;
    return current;
  }

  /**
   * Appel signé. `payload` reçoit la session (merchant_id du corps = fid_client_id). Sur ERR0401
   * (clé expirée ou remplacée), une seule réinitialisation puis un seul nouvel essai : la requête
   * refusée n'a pas été appliquée.
   */
  async function call(
    route: string,
    payload: (s: CachedSession) => Record<string, unknown>,
    accept: readonly string[] = ['ok'],
  ): Promise<{ status: string; json: unknown }> {
    for (let attempt = 0; ; attempt += 1) {
      const s = await session(attempt > 0);
      const body = JSON.stringify(payload(s));
      const authorization = s.key
        ? youfidAuthorization({
            body,
            clientId: String(s.merchantId),
            nonce: nonce(),
            timestamp: Math.floor(now() / 1000),
            key: s.key,
          })
        : null;
      const { status, json } = await post(route, body, authorization);
      const env = envelope.safeParse(json);
      if (!env.success) {
        throw new YoufidError(
          `Réponse YouFID sans statut (${route})`,
          'invalid_response',
          null,
          status,
        );
      }
      if (accept.includes(env.data.status)) return { status: env.data.status, json };
      const unauthorized = env.data.code === 'ERR0401' || (status === 401 && !env.data.code);
      if (unauthorized) {
        if (attempt === 0) continue;
        throw new YoufidError(`Accès YouFID refusé (${route})`, 'auth', 'ERR0401', status);
      }
      // Message de l'API tronqué ; il ne contient pas de donnée client d'après la documentation.
      const message = (env.data.message ?? '').slice(0, 120);
      throw new YoufidError(
        `YouFID ${route} : ${message || env.data.status}`,
        'api',
        env.data.code,
        status,
      );
    }
  }

  function read<T extends z.ZodType>(schema: T, json: unknown, route: string): z.output<T> {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new YoufidError(`Réponse YouFID inattendue (${route})`, 'invalid_response');
    }
    return parsed.data;
  }

  const question = (q: z.output<typeof profileQuestion>): YoufidProfileQuestion | null =>
    q ? { id: q.id, type: q.type } : null;

  return {
    async session() {
      const s = await session();
      return {
        merchantId: s.merchantId,
        secType: s.secType,
        loyaltyMode: s.loyaltyMode,
        expiresAt: s.expiresAt,
      };
    },

    async merchantDetails() {
      const route = 'marchandGetMerchantDetailsV2';
      const { json } = await call(route, (s) => ({ merchant_id: s.merchantId }));
      const r = read(merchantDetails, json, route);
      return {
        name: r.name,
        pointsOnAmount: r.attribution_pts === '1',
        products: [...r.products]
          .sort((a, b) => a.cost - b.cost)
          .map((p) => ({ id: p.id, cost: p.cost, name: p.name, type: p.type })),
        programName: r.loyalty_program?.name ?? null,
      };
    },

    async findCustomer(by) {
      const route = 'testmarchandCheckScanUserIfExistsV2';
      const { status, json } = await call(
        route,
        (s) => ({
          merchant_id: s.merchantId,
          ...('qrCode' in by ? { qr_code: by.qrCode } : { email: by.email }),
        }),
        ['ok', 'ko'],
      );
      if (status === 'ko') return null;
      const r = read(customer, json, route);
      return {
        usrId: r.usr_id,
        qrCode: r.qr_code,
        lastName: r.nom,
        firstName: r.prenom,
        phone: r.phone,
        smsOptin: r.sms_optin,
        profileQuestion: question(r.profile_question),
        totalPoints: r.total_points,
      };
    },

    async scan(input) {
      const route = 'marchandCheckScanUser';
      const forced = input.forcedPoints;
      if (forced !== undefined && (!Number.isSafeInteger(forced) || forced <= 0)) {
        throw new RangeError('Crédit forcé : nombre de points positif attendu');
      }
      const amount = input.amountCents !== undefined ? centsToEuros(input.amountCents) : undefined;
      const { json } = await call(route, (s) => ({
        merchant_id: s.merchantId,
        qr_code: input.qrCode,
        usr_id: numericId(input.usrId),
        ...(forced !== undefined ? { forced_amount: forced } : {}),
        ...(amount !== undefined && forced === undefined ? { amount } : {}),
      }));
      const r = read(scanResponse, json, route);
      return {
        usrId: r.usr_id ?? null,
        wonPoints: r.won_pts,
        totalPoints: r.total_pts ?? null,
        maximumScansReached: r.maximum_scans_reached,
      };
    },

    async transformToPresent(usrId, products) {
      const route = 'transformToPresent';
      const { json } = await call(route, (s) => ({
        merchant_id: s.merchantId,
        usr_id: numericId(usrId),
        products: products.map((p) => ({ id: numericId(p.id), cost: p.cost, name: p.name })),
      }));
      return { totalPoints: read(transformResponse, json, route).total_pts ?? null };
    },

    async listUsers(search, extendsSearch) {
      const route = 'marchandListUsersV2';
      const { json } = await call(route, (s) => ({
        merchant_id: s.merchantId,
        usr_input: search,
        ...(extendsSearch !== undefined ? { extends_search: extendsSearch } : {}),
      }));
      return read(listUsersResponse, json, route).users.map((u) => ({
        usrId: u.usr_id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        qrCode: u.qr_code,
      }));
    },

    async registerByPhone(phoneE164) {
      const route = 'registerCustomerByPhone';
      const { json } = await call(route, (s) => ({
        merchant_id: s.merchantId,
        phone: youfidPhone(phoneE164, phoneFormat),
      }));
      const r = read(registerResponse, json, route);
      return {
        usrId: r.usr_id,
        qrCode: r.qr_code,
        existing: Boolean(r.phone && r.phone.trim()),
        totalPoints: r.total_points,
        smsOptin: r.sms_optin,
        profileQuestion: question(r.profile_question),
      };
    },

    async submitProfileResponse(usrId, q, response) {
      await call(
        'customerSubmitResponse',
        (s) => ({
          merchant_id: s.merchantId,
          user_id: numericId(usrId),
          question: { id: numericId(q.id), type: q.type },
          response,
        }),
        ['success'],
      );
    },
  };
}
