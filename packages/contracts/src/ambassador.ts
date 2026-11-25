import { z } from 'zod';

/**
 * Ambassadeur (lot 15, ADR 0019) : le client partage son burger en story Instagram en taguant
 * l'enseigne ; bonus de points une fois la mention confirmée, une fois par ticket.
 */

/** Compte Instagram : saisi avec ou sans « @ », toujours enregistré sans. */
export const instagramHandleSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ''))
  .pipe(
    z
      .string()
      .regex(/^[A-Za-z0-9._]{1,30}$/, 'Compte Instagram invalide (lettres, chiffres, point, _)'),
  );

/** Numéro du ticket de caisse : majuscules, sans espaces. */
export const ticketRefSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9-]{3,40}$/, 'Numéro de ticket invalide'));

const TICKET_REF = /^[A-Z0-9-]{3,40}$/;
const normalizeRef = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');
const QR_PARAMS = ['ticket', 'ticketId', 'ticket_id', 'numero', 'num', 'id', 't'];

/** Octets UTF-8 d'une chaîne (sans TextEncoder : le paquet n'embarque pas les types du DOM). */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
  }
  return bytes;
}

/** Empreinte FNV-1a 64 bits en hexadécimal (16 caractères), déterministe et sans module natif. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of utf8(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v.replace(/\+/g, ' '));
  } catch {
    return v;
  }
};

/**
 * Référence de ticket tirée du QR code imprimé sur le ticket de caisse. Le format du QR Splash360
 * n'est pas encore connu (questions-en-attente n° 17) : on ne présume rien de sa structure.
 * - contenu déjà au format d'un numéro de ticket : repris tel quel (normalisé) ;
 * - URL : premier paramètre connu (ticket, ticketId, ticket_id, numero, num, id, t) au bon format,
 *   sinon dernier segment du chemin au bon format ;
 * - sinon : « QR- » + empreinte du contenu (un même ticket donne toujours la même référence, ce
 *   qui suffit pour « une participation par ticket »).
 * Le serveur la recalcule lui-même à partir du contenu brut : il ne fait pas confiance au client.
 */
export function ticketRefFromQr(raw: string): string {
  const content = raw.trim();
  const direct = normalizeRef(content);
  if (TICKET_REF.test(direct)) return direct;
  const url = /^https?:\/\/[^/?#]+([^?#]*)(?:\?([^#]*))?/i.exec(content);
  if (url) {
    const params = new Map<string, string>();
    for (const pair of (url[2] ?? '').split('&')) {
      const [name = '', value = ''] = pair.split('=');
      const key = safeDecode(name);
      if (key && !params.has(key)) params.set(key, safeDecode(value));
    }
    for (const name of QR_PARAMS) {
      const value = params.get(name);
      if (value !== undefined && TICKET_REF.test(normalizeRef(value))) return normalizeRef(value);
    }
    const last = (url[1] ?? '').split('/').filter(Boolean).at(-1);
    if (last && TICKET_REF.test(normalizeRef(safeDecode(last))))
      return normalizeRef(safeDecode(last));
  }
  return `QR-${fnv1a64(content).toUpperCase()}`;
}

/** Contenu brut du QR code du ticket : 512 caractères imprimables au plus. */
export const ticketQrSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[\x20-\x7E\u00A0-\uFFFF]+$/, 'QR code illisible');

/** Réponse publique de GET /v1/tenants/{subdomain}/ambassador. */
export const ambassadorConfigSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(true),
    /** Compte à taguer, sans « @ » (le bouton « Copier » copie cette valeur telle quelle). */
    instagramHandle: z.string(),
    bonusPoints: z.number().int().positive(),
  }),
  z.object({ enabled: z.literal(false) }),
]);
export type AmbassadorConfig = z.infer<typeof ambassadorConfigSchema>;

/** POST /v1/tenants/{subdomain}/ambassador/entries (membre connecté). */
export const ambassadorEntryRequestSchema = z.object({
  ticketRef: ticketRefSchema,
  /** Contenu brut du QR scanné : le serveur en déduit lui-même `ticketRef` (ticketRefFromQr). */
  ticketQr: ticketQrSchema.optional(),
  instagramHandle: instagramHandleSchema,
});
export type AmbassadorEntryRequest = z.input<typeof ambassadorEntryRequestSchema>;

export const ambassadorStatusSchema = z.enum(['pending', 'confirmed', 'rejected']);

export const ambassadorEntrySchema = z.object({
  id: z.string(),
  status: ambassadorStatusSchema,
  ticketRef: z.string(),
  bonusPoints: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type AmbassadorEntryDto = z.infer<typeof ambassadorEntrySchema>;

export const ambassadorEntriesSchema = z.object({ entries: z.array(ambassadorEntrySchema) });

/** Back-office : réglages de l'enseigne. */
export const ambassadorSettingsSchema = z
  .object({
    enabled: z.boolean(),
    instagramHandle: instagramHandleSchema.nullable(),
    bonusPoints: z.number().int().min(1).max(10000),
  })
  .refine((s) => !s.enabled || s.instagramHandle !== null, {
    message: 'Indiquez le compte Instagram à taguer',
    path: ['instagramHandle'],
  });
export type AmbassadorSettingsDto = z.infer<typeof ambassadorSettingsSchema>;

/** Back-office : participations reçues. */
export const adminAmbassadorEntriesSchema = z.object({
  entries: z.array(
    ambassadorEntrySchema.extend({
      memberId: z.string(),
      /** Participation déclarée par scan du QR du ticket (sinon numéro saisi). */
      scanned: z.boolean().default(false),
      instagramHandle: z.string(),
      decidedAt: z.iso.datetime().nullable(),
    }),
  ),
});
