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

/** Identifiant de vente Splash360 (UUID 8-4-4-4-12), où qu'il soit dans un texte. */
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * `ticket_id` Splash360 contenu dans un QR de ticket (UUID seul ou dans une URL), en minuscules ;
 * null sinon. Lot 20 (ADR 0025) : un ticket de borne scanné est alors vérifié comme une photo.
 */
export function ticketIdFromQr(raw: string): string | null {
  const content = raw.trim();
  const found = UUID_IN_TEXT.exec(content) ?? UUID_IN_TEXT.exec(safeDecode(content));
  return found ? found[0].toLowerCase() : null;
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
  // Identifiant de vente Splash360 (lot 20) : la référence est l'identifiant en majuscules,
  // comme pour un ticket photographié (une participation par ticket, quel que soit le moyen).
  const ticketId = ticketIdFromQr(content);
  if (ticketId) return ticketId.toUpperCase();
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
export const ambassadorEntryRequestSchema = z
  .object({
    /** Numéro saisi (ou déduit du QR) ; facultatif avec `ticketPhoto`, dont le serveur le déduit. */
    ticketRef: ticketRefSchema.optional(),
    /** Contenu brut du QR scanné : le serveur en déduit lui-même `ticketRef` (ticketRefFromQr). */
    ticketQr: ticketQrSchema.optional(),
    /**
     * Jeton de la photo du ticket (POST …/ambassador/ticket-photo, lot 20) : le serveur en déduit
     * la référence du ticket et vérifie l'achat auprès de la caisse.
     */
    ticketPhoto: z.string().max(2200).optional(),
    instagramHandle: instagramHandleSchema,
    /** Jeton du verdict de la photo (POST …/ambassador/photo-check) ; absent = « à vérifier ». */
    photoCheck: z.string().max(2200).optional(),
  })
  .refine((r) => !(r.ticketQr && r.ticketPhoto), {
    message: 'Un seul ticket : scanné ou photographié',
    path: ['ticketPhoto'],
  })
  .refine((r) => r.ticketPhoto !== undefined || r.ticketRef !== undefined, {
    message: 'Numéro de ticket invalide',
    path: ['ticketRef'],
  });
export type AmbassadorEntryRequest = z.input<typeof ambassadorEntryRequestSchema>;

/**
 * Vérification du ticket (lot 20, ADR 0025) :
 * - unverified : ticket scanné ou saisi, jamais vérifié ;
 * - pending : ticket photographié, vérification auprès de la caisse en cours ;
 * - verified : achat vérifié (commande encaissée trouvée) ;
 * - unpaid : commande annulée en caisse (participation refusée) ;
 * - not_found : ticket introuvable, vérification par le restaurant.
 */
export const ticketCheckSchema = z.enum([
  'unverified',
  'pending',
  'verified',
  'unpaid',
  'not_found',
]);
export type TicketCheckDto = z.infer<typeof ticketCheckSchema>;

/** Âge maximal d'un ticket photographié, en jours (journée de Paris). */
export const TICKET_PHOTO_MAX_AGE_DAYS = 7;

/** POST /v1/tenants/{subdomain}/ambassador/ticket-photo : même format que la photo du produit. */
export const ticketPhotoResponseSchema = z.object({
  /** Faux : ticket illisible (ou lecture indisponible), le client tape le numéro. */
  readable: z.boolean(),
  /** `ticket_id` Splash360 imprimé sur le ticket (UUID, en minuscules). */
  ticketId: z.string().nullable(),
  /** Date imprimée (AAAA-MM-JJ). */
  date: z.string().nullable(),
  /** Heure imprimée (HH:MM), si lisible. */
  time: z.string().nullable(),
  totalCents: z.number().int().nonnegative().nullable(),
  /** À renvoyer avec la participation (valable 30 minutes) ; null si illisible. */
  token: z.string().nullable(),
});
export type TicketPhotoResponse = z.infer<typeof ticketPhotoResponseSchema>;

export const ambassadorStatusSchema = z.enum(['pending', 'confirmed', 'rejected']);
export const photoVerdictSchema = z.enum(['accepted', 'rejected', 'doubtful']);
export type PhotoVerdictDto = z.infer<typeof photoVerdictSchema>;

/**
 * Étape lisible d'une participation (lot 17) :
 * - pending : enregistrée, en attente de la mention de l'enseigne ;
 * - to_review : photo à vérifier par l'équipe (douteuse ou non analysée) ;
 * - mention_received : mention constatée, points prévus à `creditDueAt` ;
 * - credited / rejected : décision définitive.
 */
export const ambassadorStageSchema = z.enum([
  'pending',
  'to_review',
  'mention_received',
  'credited',
  'rejected',
]);
export type AmbassadorStage = z.infer<typeof ambassadorStageSchema>;

export const ambassadorEntrySchema = z.object({
  id: z.string(),
  status: ambassadorStatusSchema,
  stage: ambassadorStageSchema,
  ticketRef: z.string(),
  bonusPoints: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  mentionReceivedAt: z.iso.datetime().nullable(),
  /** Crédit prévu des points (mention + délai de l'enseigne). */
  creditDueAt: z.iso.datetime().nullable(),
  photoVerdict: photoVerdictSchema.nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** Vérification du ticket auprès de la caisse (lot 20). */
  ticketCheck: ticketCheckSchema.default('unverified'),
});
export type AmbassadorEntryDto = z.infer<typeof ambassadorEntrySchema>;

export const ambassadorEntriesSchema = z.object({ entries: z.array(ambassadorEntrySchema) });

/** GET/PUT /v1/tenants/{subdomain}/ambassador/profile : compte Instagram mémorisé du membre. */
export const ambassadorProfileSchema = z.object({
  instagramHandle: z.string().nullable(),
});
export type AmbassadorProfileDto = z.infer<typeof ambassadorProfileSchema>;
export const ambassadorProfileRequestSchema = z.object({ instagramHandle: instagramHandleSchema });

/** Formats de photo acceptés par l'analyse (4 Mo au plus, jamais conservée). */
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** POST /v1/tenants/{subdomain}/ambassador/photo-check (membre connecté). */
export const photoCheckRequestSchema = z.object({
  mediaType: z.enum(PHOTO_MEDIA_TYPES),
  /** Image en base64 (sans préfixe data:). */
  data: z
    .string()
    .max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4, 'Photo trop lourde : 4 Mo maximum')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Photo illisible'),
});
export type PhotoCheckRequest = z.infer<typeof photoCheckRequestSchema>;

export const photoCheckResponseSchema = z.object({
  verdict: photoVerdictSchema,
  reason: z.string(),
  /** À renvoyer avec la participation (valable 30 minutes). */
  token: z.string(),
});
export type PhotoCheckResponse = z.infer<typeof photoCheckResponseSchema>;

const delaysOk = (s: {
  checkAfterHours?: number | undefined;
  creditAfterHours?: number | undefined;
}) =>
  s.checkAfterHours === undefined ||
  s.creditAfterHours === undefined ||
  s.checkAfterHours <= s.creditAfterHours;

/** Back-office : réglages de l'enseigne. Délais et catégorie facultatifs (inchangés si absents). */
export const ambassadorSettingsSchema = z
  .object({
    enabled: z.boolean(),
    instagramHandle: instagramHandleSchema.nullable(),
    bonusPoints: z.number().int().min(1).max(10000),
    /** Contrôle de la story, en heures après la mention (défaut 20). */
    checkAfterHours: z.number().int().min(1).max(72).optional(),
    /** Crédit des points, en heures après la mention (défaut 24). */
    creditAfterHours: z.number().int().min(1).max(168).optional(),
    /** Catégorie de l'enseigne (burgers, pizza…) pour l'analyse de la photo. */
    photoCategory: z.string().trim().min(2).max(60).optional(),
  })
  .refine((s) => !s.enabled || s.instagramHandle !== null, {
    message: 'Indiquez le compte Instagram à taguer',
    path: ['instagramHandle'],
  })
  .refine(delaysOk, {
    message: 'Le contrôle doit avoir lieu avant le crédit des points',
    path: ['checkAfterHours'],
  });
export type AmbassadorSettingsDto = z.infer<typeof ambassadorSettingsSchema>;
export type AmbassadorSettingsInput = z.input<typeof ambassadorSettingsSchema>;

export const ambassadorEventTypeSchema = z.enum([
  'created',
  'photo_checked',
  'mention_received',
  'story_checked',
  'credited',
  'credit_failed',
  'rejected',
  /* Lot 20 (ADR 0025) : lecture du ticket photographié, puis rapprochement avec les ventes. */
  'ticket_read',
  'ticket_checked',
]);
export type AmbassadorEventType = z.infer<typeof ambassadorEventTypeSchema>;

export const ambassadorEventSchema = z.object({
  type: ambassadorEventTypeSchema,
  /** « client », « système », « IA » ou l'e-mail du membre de l'équipe. */
  actor: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  at: z.iso.datetime(),
});
export type AmbassadorEventDto = z.infer<typeof ambassadorEventSchema>;

/** Back-office : participations reçues, avec leur historique complet. */
export const adminAmbassadorEntrySchema = ambassadorEntrySchema.extend({
  memberId: z.string(),
  /** Participation déclarée par scan du QR du ticket (sinon numéro saisi). */
  scanned: z.boolean().default(false),
  instagramHandle: z.string(),
  mentionBy: z.string().nullable(),
  checkDueAt: z.iso.datetime().nullable(),
  checkResult: z.enum(['online', 'removed']).nullable(),
  photoReason: z.string().nullable(),
  needsReview: z.boolean(),
  /** Ticket vérifiable (lot 20) : identifiant Splash360, et date, heure, total lus sur la photo. */
  ticketId: z.string().nullable().default(null),
  ticketDate: z.string().nullable().default(null),
  ticketTime: z.string().nullable().default(null),
  ticketTotalCents: z.number().int().nullable().default(null),
  events: z.array(ambassadorEventSchema),
});
export type AdminAmbassadorEntryDto = z.infer<typeof adminAmbassadorEntrySchema>;
export const adminAmbassadorEntriesSchema = z.object({
  entries: z.array(adminAmbassadorEntrySchema),
});
