/** Thème d'une enseigne (complété au lot 1). */
export interface TenantTheme {
  readonly primaryColor: string;
  readonly mode: 'light' | 'dark';
  readonly logoUrl: string | null;
  readonly tagline: string | null;
}
