/**
 * État d'une commande côté caisse Splash360, lu dans la réponse de `cmdstatus`.
 *
 * La documentation ne liste pas les valeurs (elle ne décrit que `status: success`) ; le CTO de
 * Splash360 a indiqué oralement : en attente (« pending »), puis « ready » quand la caisse peut
 * accepter la commande, puis « confirmed » une fois le paiement intégré. La lecture est donc
 * tolérante (casse, accents, synonymes) ; une valeur inconnue est traitée comme « on attend ».
 */
export type CommandeState = 'pending' | 'ready' | 'confirmed' | 'failed';

export interface CommandeStatus {
  readonly state: CommandeState;
  /** Valeur brute lue, gardée pour le journal et le back-office. */
  readonly raw: string | null;
}

const SYNONYMS: Record<string, CommandeState> = {
  pending: 'pending',
  standby: 'pending',
  waiting: 'pending',
  attente: 'pending',
  enattente: 'pending',
  ready: 'ready',
  pret: 'ready',
  prete: 'ready',
  confirmed: 'confirmed',
  confirme: 'confirmed',
  confirmee: 'confirmed',
  integrated: 'confirmed',
  integree: 'confirmed',
  error: 'failed',
  failed: 'failed',
  rejected: 'failed',
  refused: 'failed',
  refusee: 'failed',
  cancelled: 'failed',
  canceled: 'failed',
  annulee: 'failed',
};

/** Champs où chercher le statut de la commande, par ordre de préférence. */
const FIELDS = [
  'cmdstatus',
  'cmdStatus',
  'commandeStatus',
  'commande_status',
  'statut',
  'state',
  'status',
] as const;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function pick(body: Record<string, unknown>): string | null {
  for (const field of FIELDS) {
    const v = body[field];
    // « success » décrit l'appel HTTP, pas l'état de la commande.
    if (typeof v === 'string' && v.trim() !== '' && normalize(v) !== 'success') return v;
  }
  for (const nested of ['commande', 'data', 'order']) {
    const v = body[nested];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = pick(v as Record<string, unknown>);
      if (found) return found;
    }
  }
  return null;
}

export function readCommandeStatus(body: unknown): CommandeStatus {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { state: 'pending', raw: null };
  }
  const raw = pick(body as Record<string, unknown>);
  if (!raw) return { state: 'pending', raw: null };
  const key = normalize(raw);
  const state = SYNONYMS[key] ?? (key.startsWith('cancel') ? 'failed' : 'pending');
  return { state, raw };
}
