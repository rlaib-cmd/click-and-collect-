import type { TenantTheme } from './theme';

/** Réglage du design modifié entre la version publiée et le brouillon (lot 12). */
export type ThemeField =
  | 'logoUrl'
  | 'primaryColor'
  | 'loyaltyColor'
  | 'mode'
  | 'tagline'
  | 'header'
  | 'corners'
  | 'uppercaseTitles'
  | 'pattern';

const sameColor = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null)?.toUpperCase() === (b ?? null)?.toUpperCase();

/**
 * Liste des réglages qui changeront à la publication du brouillon, dans l'ordre du formulaire.
 * Les couleurs sont comparées sans tenir compte de la casse ; un slogan vide vaut « aucun ».
 */
export function themeChanges(live: TenantTheme, draft: TenantTheme): ThemeField[] {
  const changes: ThemeField[] = [];
  if ((live.logoUrl ?? null) !== (draft.logoUrl ?? null)) changes.push('logoUrl');
  if (!sameColor(live.primaryColor, draft.primaryColor)) changes.push('primaryColor');
  if (!sameColor(live.loyaltyColor, draft.loyaltyColor)) changes.push('loyaltyColor');
  if (live.mode !== draft.mode) changes.push('mode');
  if ((live.tagline?.trim() || null) !== (draft.tagline?.trim() || null)) changes.push('tagline');
  if (live.style.header !== draft.style.header) changes.push('header');
  if (live.style.corners !== draft.style.corners) changes.push('corners');
  if (live.style.uppercaseTitles !== draft.style.uppercaseTitles) changes.push('uppercaseTitles');
  if (live.style.pattern !== draft.style.pattern) changes.push('pattern');
  return changes;
}
