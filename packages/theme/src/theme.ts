import { BLACK, contrastRatio, readableTextOn, WHITE } from './color';

export type ThemeMode = 'light' | 'dark';

/** Style visuel de l'enseigne, au-delà des couleurs. */
export interface ThemeStyle {
  /** `brand` : en-têtes sur fond de la couleur de l'enseigne (logo clair attendu). */
  readonly header: 'plain' | 'brand';
  readonly corners: 'rounded' | 'pill' | 'square';
  readonly uppercaseTitles: boolean;
  /** Motif décoratif sous les en-têtes (`checker` : damier aux couleurs de l'enseigne). */
  readonly pattern: 'none' | 'checker';
}

export const DEFAULT_STYLE: ThemeStyle = {
  header: 'plain',
  corners: 'rounded',
  uppercaseTitles: false,
  pattern: 'none',
};

/** Réglages de design saisis par l'enseigne. */
export interface TenantTheme {
  readonly primaryColor: string;
  readonly mode: ThemeMode;
  readonly logoUrl: string | null;
  readonly tagline: string | null;
  readonly style: ThemeStyle;
}

/** Rayons des angles (boutons, cartes, puces) selon le style. */
export interface Radii {
  readonly button: number;
  readonly card: number;
  readonly chip: number;
}

export function radiiFor(corners: ThemeStyle['corners']): Radii {
  switch (corners) {
    case 'pill':
      return { button: 999, card: 16, chip: 999 };
    case 'square':
      return { button: 2, card: 2, chip: 2 };
    default:
      return { button: 12, card: 12, chip: 22 };
  }
}

/** Palette complète utilisée par les écrans. */
export interface Palette {
  readonly mode: ThemeMode;
  readonly primary: string;
  readonly onPrimary: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  /** Couleur d'accent lisible sur le fond (liens, icônes) : la couleur de l'enseigne si elle contraste assez. */
  readonly accent: string;
}

const BASE = {
  light: {
    background: '#FFFFFF',
    surface: '#F5F5F7',
    text: '#111111',
    textMuted: '#5F6368',
    border: '#E2E2E6',
  },
  dark: {
    background: '#0E0E10',
    surface: '#1A1A1E',
    text: '#F5F5F7',
    textMuted: '#A1A1AA',
    border: '#2C2C31',
  },
} as const;

/** Contraste minimal WCAG AA pour les éléments graphiques et le texte large. */
export const MIN_UI_CONTRAST = 3;

export function buildPalette(theme: Pick<TenantTheme, 'primaryColor' | 'mode'>): Palette {
  const base = BASE[theme.mode];
  const primary = theme.primaryColor.toUpperCase();
  const accent =
    contrastRatio(primary, base.background) >= MIN_UI_CONTRAST
      ? primary
      : theme.mode === 'dark'
        ? WHITE
        : BLACK;
  return { mode: theme.mode, primary, onPrimary: readableTextOn(primary), accent, ...base };
}

export const DEFAULT_THEME: TenantTheme = {
  primaryColor: '#1F6FEB',
  mode: 'light',
  logoUrl: null,
  tagline: null,
  style: DEFAULT_STYLE,
};
