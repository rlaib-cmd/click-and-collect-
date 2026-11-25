import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

/**
 * Signature des requêtes YouFID (SPLASH FID POS API, docs/api-splash360/fidelite-youfid.md) :
 * sign = HMAC-SHA256(corps brut + fid_client_id + nonce + timestamp, clé), en hexadécimal.
 * La clé est la `session_key` décodée de l'hexadécimal (128 caractères hexadécimaux → 64 octets).
 */

/** Seul algorithme vérifié par le serveur, quel que soit `sign_algo` (remarques d'intégration). */
export const YOUFID_SIGN_ALGO = 'HMAC_SHA256';

/** `session_key` hexadécimale → clé de signature. Refuse une clé mal formée (sans la citer). */
export function decodeSessionKey(hex: string): Buffer {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    throw new Error('Clé de session YouFID mal formée');
  }
  return Buffer.from(clean, 'hex');
}

export interface SignatureInput {
  /** Corps exact envoyé, au caractère près. */
  readonly body: string;
  /** `fid_client_id` : le `merchant_id` du marchand. */
  readonly clientId: string;
  readonly nonce: string;
  /** Horodatage Unix en secondes. */
  readonly timestamp: number;
  readonly key: Buffer;
}

export function signYoufidRequest(input: SignatureInput): string {
  return createHmac('sha256', input.key)
    .update(`${input.body}${input.clientId}${input.nonce}${String(input.timestamp)}`, 'utf8')
    .digest('hex');
}

/** En-tête `Authorization` : paires clé=valeur séparées par des virgules, sans espace. */
export function youfidAuthorization(input: SignatureInput): string {
  return [
    `fid_client_id=${input.clientId}`,
    `nonce=${input.nonce}`,
    `timestamp=${String(input.timestamp)}`,
    `sign_algo=${YOUFID_SIGN_ALGO}`,
    `sign=${signYoufidRequest(input)}`,
  ].join(',');
}
