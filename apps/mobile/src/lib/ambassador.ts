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
