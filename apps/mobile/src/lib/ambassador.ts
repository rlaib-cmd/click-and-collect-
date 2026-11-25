import type {
  AmbassadorEntryDto,
  PhotoVerdictDto,
  TicketPhotoResponse,
} from '@splash360/contracts';
import { formatPrice } from './format';
import { messages } from '@splash360/i18n';

/**
 * Ambassadeur (lot 15) : le compte à taguer s'affiche avec « @ », mais se copie SANS « @ » :
 * collé dans le sticker @Mention d'Instagram, un « @ » en trop empêche de trouver le compte
 * (retour du testeur Bills Burger).
 */
export const handleForCopy = (handle: string) => handle.trim().replace(/^@+/, '');

export const displayHandle = (handle: string) => `@${handleForCopy(handle)}`;

export type AmbassadorStep = 'intro' | 'ticket' | 'photo' | 'story' | 'sent';

/** Étape de la barre de progression (Ticket → Burger → Story). */
export function progressIndex(step: AmbassadorStep): number {
  if (step === 'ticket') return 0;
  if (step === 'photo') return 1;
  return step === 'story' || step === 'sent' ? 2 : -1;
}

/** « mer. 26 nov. à 09:00 » : date prévue du crédit, à l'heure de Paris. */
export function formatCreditDate(iso: string, timeZone = 'Europe/Paris'): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')} à ${get('hour')}:${get('minute')}`;
}

/** Étape lisible d'une participation, pour le client (lot 17). */
export function stageLabel(entry: AmbassadorEntryDto, brand: string): string {
  const s = messages.ambassador.stage;
  switch (entry.stage) {
    case 'mention_received':
      return entry.creditDueAt
        ? s.mention_received(entry.bonusPoints, formatCreditDate(entry.creditDueAt))
        : s.pending(brand);
    case 'credited':
      return s.credited(entry.bonusPoints);
    case 'rejected':
      return s.rejected;
    case 'to_review':
      return s.to_review;
    default:
      return s.pending(brand);
  }
}

/** Message après l'analyse de la photo ; `blocking` : il faut reprendre la photo. */
export function photoFeedback(
  verdict: PhotoVerdictDto | 'error',
  brand: string,
): { readonly text: string; readonly blocking: boolean } {
  const t = messages.ambassador;
  if (verdict === 'rejected') return { text: t.photoRejected(brand), blocking: true };
  if (verdict === 'accepted') return { text: t.photoAccepted, blocking: false };
  if (verdict === 'doubtful') return { text: t.photoDoubtful, blocking: false };
  return { text: t.photoCheckError, blocking: false };
}

/** Vérification du ticket photographié (lot 20) ; null pour un ticket scanné ou saisi. */
export function ticketCheckLabel(entry: AmbassadorEntryDto): string | null {
  const labels = messages.ambassador.ticketCheck;
  switch (entry.ticketCheck) {
    case 'verified':
    case 'pending':
    case 'not_found':
    case 'unpaid':
      return labels[entry.ticketCheck];
    default:
      return null;
  }
}

/** « Commande n° 6 · 24/11/2026 · 12,30 € » : ce que l'IA a lu, à confirmer par le client. */
export function ticketReadSummary(read: TicketPhotoResponse): string | null {
  if (!read.readable || !read.orderNumber || !read.date || read.totalCents === null) return null;
  const date = read.date.split('-').reverse().join('/');
  return messages.ambassador.ticketRead(read.orderNumber, date, formatPrice(read.totalCents));
}
