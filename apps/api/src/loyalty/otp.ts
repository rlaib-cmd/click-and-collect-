import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  canSendOtp,
  checkOtpChallenge,
  normalizeOtpIdentifier,
  otpCodeFromRandom,
  smsSenderName,
  type OtpChannel,
} from '@splash360/core';
import type { OtpStore } from '@splash360/db';

/** Envoi des SMS (Brevo). */
export interface SmsSender {
  /** false : aucun prestataire, le SMS est seulement journalisé. */
  readonly configured: boolean;
  send(to: string, sender: string, text: string): Promise<void>;
}

/**
 * SMS transactionnels Brevo (POST https://api.brevo.com/v3/transactionalSMS/send).
 * Sans clé, le message est journalisé (numéro masqué) au lieu d'être envoyé.
 */
export function createSmsSender(options: {
  brevoApiKey?: string | undefined;
  log: (m: string, d?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}): SmsSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.brevoApiKey;
  return {
    configured: Boolean(apiKey),
    async send(to, sender, text) {
      if (!apiKey) {
        options.log('SMS (prestataire non configuré)', { to: `${to.slice(0, 5)}*****` });
        return;
      }
      const res = await fetchImpl('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          sender,
          recipient: to.replace(/^\+/, ''),
          content: text,
          type: 'transactional',
          tag: 'login-code',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Brevo SMS : HTTP ${res.status}`);
    },
  };
}

/**
 * Renvoyer le code dans la réponse (pour tester) n'est permis qu'en recette, sur un canal
 * sans prestataire : le code n'atteint alors personne d'autre que le testeur.
 */
export function otpDebugEchoAllowed(input: {
  readonly flag: boolean;
  readonly environment: string;
  readonly providerConfigured: boolean;
}): boolean {
  return input.flag && !input.providerConfigured && input.environment !== 'production';
}

export interface OtpDeps {
  readonly store: OtpStore;
  readonly sms: SmsSender;
  /** E-mail transactionnel (Brevo), journalisé sans prestataire. */
  readonly email: (to: string, message: { subject: string; text: string }) => Promise<void>;
  readonly emailConfigured: boolean;
  /** Secret serveur des empreintes de codes. */
  readonly hashSecret: string;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly now: () => Date;
  /** OTP_DEBUG_ECHO=1 et environnement (voir otpDebugEchoAllowed). */
  readonly debugEcho: boolean;
  readonly environment: string;
  /**
   * Plafond d'envoi de codes par enseigne et par heure, tous numéros confondus, compté en base
   * (partagé entre les instances) : empêche l'envoi massif de SMS facturés (audit M2). Défaut 300.
   */
  readonly tenantHourlyLimit?: number;
  readonly log: (m: string, d?: Record<string, unknown>) => void;
}

export function hashOtp(
  secret: string,
  tenantId: string,
  channel: OtpChannel,
  identifier: string,
  code: string,
): string {
  return createHmac('sha256', secret)
    .update(`otp:${tenantId}:${channel}:${identifier}:${code}`)
    .digest('hex');
}

const sameHash = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type StartResult =
  | {
      readonly ok: true;
      readonly identifier: string;
      readonly resendInSeconds: number;
      readonly debugCode?: string;
    }
  | { readonly ok: false; readonly error: 'invalid_identifier' }
  | { readonly ok: false; readonly error: 'rate_limited'; readonly retryAfterSeconds: number };

/** Envoie un code ; même résultat qu'un compte existe ou non (pas d'énumération). */
export async function startOtp(
  deps: OtpDeps,
  tenant: { readonly id: string; readonly name: string },
  channel: OtpChannel,
  raw: string,
): Promise<StartResult> {
  const identifier = normalizeOtpIdentifier(channel, raw);
  if (!identifier) return { ok: false, error: 'invalid_identifier' };
  const now = deps.now();
  const sends = await deps.store.recentSends(
    tenant.id,
    identifier,
    new Date(now.getTime() - 3_600_000),
  );
  const hourAgo = new Date(now.getTime() - 3_600_000);
  if ((await deps.store.countTenantSends(tenant.id, hourAgo)) >= (deps.tenantHourlyLimit ?? 300)) {
    deps.log('Plafond horaire de codes atteint pour l’enseigne', { tenantId: tenant.id });
    return { ok: false, error: 'rate_limited', retryAfterSeconds: 600 };
  }
  const decision = canSendOtp(sends, now);
  if (!decision.ok) {
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000),
    };
  }
  const code = otpCodeFromRandom(deps.randomBytes(4));
  await deps.store.create(tenant.id, {
    channel,
    identifier,
    codeHash: hashOtp(deps.hashSecret, tenant.id, channel, identifier, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  });
  const text = `${code} est ton code de connexion ${tenant.name}. Il expire dans 10 minutes. Ne le partage avec personne.`;
  try {
    if (channel === 'sms') await deps.sms.send(identifier, smsSenderName(tenant.name), text);
    else
      await deps.email(identifier, {
        subject: `${code} : ton code de connexion ${tenant.name}`,
        text: `Bonjour,\n\n${text}\n\nSi tu n'as rien demandé, ignore ce message.`,
      });
  } catch (error) {
    // L'envoi a échoué : le client redemandera un code après le délai.
    deps.log('Envoi du code de connexion en échec', { channel, error: String(error) });
  }
  const echo = otpDebugEchoAllowed({
    flag: deps.debugEcho,
    environment: deps.environment,
    providerConfigured: channel === 'sms' ? deps.sms.configured : deps.emailConfigured,
  });
  return {
    ok: true,
    identifier,
    resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    ...(echo ? { debugCode: code } : {}),
  };
}

export type VerifyResult =
  | { readonly ok: true; readonly challengeId: string; readonly identifier: string }
  | { readonly ok: false; readonly error: 'otp_invalid' | 'otp_expired' };

/**
 * Vérifie le code (essais comptés, comparaison à temps constant). Ne consomme pas le code :
 * l'appelant le consomme en ouvrant la session (`consumeOtp`), ou le garde pour l'inscription.
 */
export async function verifyOtp(
  deps: OtpDeps,
  tenantId: string,
  channel: OtpChannel,
  raw: string,
  code: string,
): Promise<VerifyResult> {
  const identifier = normalizeOtpIdentifier(channel, raw);
  if (!identifier) return { ok: false, error: 'otp_invalid' };
  const challenge = await deps.store.latest(tenantId, channel, identifier);
  if (!challenge) return { ok: false, error: 'otp_invalid' };
  const check = checkOtpChallenge(challenge, deps.now());
  if (!check.ok) return { ok: false, error: 'otp_expired' };
  const match = sameHash(
    challenge.codeHash,
    hashOtp(deps.hashSecret, tenantId, channel, identifier, code),
  );
  // Chaque essai compte, y compris la fin d'inscription avec un code déjà validé.
  const counted = await deps.store.recordAttempt(challenge.id, OTP_MAX_ATTEMPTS, match);
  if (!counted) return { ok: false, error: 'otp_expired' };
  return match
    ? { ok: true, challengeId: challenge.id, identifier }
    : { ok: false, error: 'otp_invalid' };
}

export const consumeOtp = (deps: OtpDeps, challengeId: string) => deps.store.consume(challengeId);

/** Secret des empreintes de codes, dérivé du secret des jetons (usage distinct). */
export function otpHashSecret(baseSecret: string): string {
  return createHmac('sha256', baseSecret).update('splash360:otp-code').digest('base64url');
}

/** Assemble les dépendances de la connexion par code (serveur Node et Edge Function). */
export function createOtpDeps(options: {
  readonly store: OtpStore;
  readonly sms: SmsSender;
  readonly notifier: {
    email(to: string, message: { subject: string; text: string }): Promise<void>;
  };
  readonly emailConfigured: boolean;
  readonly baseSecret: string;
  readonly debugEcho: boolean;
  readonly environment: string;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly log: (m: string, d?: Record<string, unknown>) => void;
  readonly now?: () => Date;
  readonly tenantHourlyLimit?: number;
}): OtpDeps {
  return {
    store: options.store,
    sms: options.sms,
    email: (to, message) => options.notifier.email(to, message),
    emailConfigured: options.emailConfigured,
    hashSecret: otpHashSecret(options.baseSecret),
    randomBytes: options.randomBytes,
    now: options.now ?? (() => new Date()),
    debugEcho: options.debugEcho,
    environment: options.environment,
    log: options.log,
    ...(options.tenantHourlyLimit !== undefined
      ? { tenantHourlyLimit: options.tenantHourlyLimit }
      : {}),
  };
}
