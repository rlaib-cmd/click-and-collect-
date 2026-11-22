import type { Sql } from './client';

export type TenantStatus = 'active' | 'suspended';
export type ThemeMode = 'light' | 'dark';

/** Style visuel de l'enseigne (colonnes header_style, corner_style, uppercase_titles, pattern). */
export interface ThemeStyle {
  readonly header: 'plain' | 'brand';
  readonly corners: 'rounded' | 'pill' | 'square';
  readonly uppercaseTitles: boolean;
  readonly pattern: 'none' | 'checker';
}

/** Colonnes de style telles que lues en base. */
export interface ThemeStyleRow {
  header_style: ThemeStyle['header'];
  corner_style: ThemeStyle['corners'];
  uppercase_titles: boolean;
  pattern: ThemeStyle['pattern'];
}

export function toThemeStyle(r: ThemeStyleRow): ThemeStyle {
  return {
    header: r.header_style,
    corners: r.corner_style,
    uppercaseTitles: r.uppercase_titles,
    pattern: r.pattern,
  };
}

/** Enseigne et son thème, tels que lus en base. */
export interface TenantWithTheme {
  readonly id: string;
  readonly name: string;
  readonly subdomain: string;
  readonly status: TenantStatus;
  /** Commission Splash360 (lot 4). */
  readonly applicationFee: { readonly bps: number; readonly fixedCents: number };
  readonly theme: {
    readonly primaryColor: string;
    readonly mode: ThemeMode;
    readonly logoUrl: string | null;
    readonly tagline: string | null;
    readonly style: ThemeStyle;
  } | null;
}

export interface TenantStore {
  findBySubdomain(subdomain: string): Promise<TenantWithTheme | null>;
  findById(id: string): Promise<TenantWithTheme | null>;
}

interface Row extends ThemeStyleRow {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  application_fee_bps: number;
  application_fee_fixed_cents: number;
  primary_color: string | null;
  mode: ThemeMode | null;
  logo_url: string | null;
  tagline: string | null;
}

function toTenant(row: Row): TenantWithTheme {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    status: row.status,
    applicationFee: { bps: row.application_fee_bps, fixedCents: row.application_fee_fixed_cents },
    theme:
      row.primary_color && row.mode
        ? {
            primaryColor: row.primary_color,
            mode: row.mode,
            logoUrl: row.logo_url,
            tagline: row.tagline,
            style: toThemeStyle(row),
          }
        : null,
  };
}

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresTenantStore(sql: Sql): TenantStore {
  const select = (where: ReturnType<Sql>) => sql<Row[]>`
    select t.id, t.name, t.subdomain, t.status, t.application_fee_bps, t.application_fee_fixed_cents,
           th.primary_color, th.mode, th.logo_url, th.tagline,
           th.header_style, th.corner_style, th.uppercase_titles, th.pattern
    from public.tenants t
    left join public.tenant_theme th on th.tenant_id = t.id
    where ${where}
    limit 1`;
  return {
    async findBySubdomain(subdomain) {
      const [row] = await select(sql`t.subdomain = ${subdomain}`);
      return row ? toTenant(row) : null;
    },
    async findById(id) {
      if (!TENANT_UUID.test(id)) return null;
      const [row] = await select(sql`t.id = ${id}`);
      return row ? toTenant(row) : null;
    },
  };
}

/** Implémentation en mémoire, pour les tests. */
export function createMemoryTenantStore(tenants: readonly TenantWithTheme[]): TenantStore {
  return {
    findBySubdomain: (subdomain) =>
      Promise.resolve(tenants.find((t) => t.subdomain === subdomain) ?? null),
    findById: (id) => Promise.resolve(tenants.find((t) => t.id === id) ?? null),
  };
}
