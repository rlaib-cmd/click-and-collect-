import type { Sql } from './client';

export type TenantStatus = 'active' | 'suspended';
export type ThemeMode = 'light' | 'dark';

/** Enseigne et son thème, tels que lus en base. */
export interface TenantWithTheme {
  readonly id: string;
  readonly name: string;
  readonly subdomain: string;
  readonly status: TenantStatus;
  readonly theme: {
    readonly primaryColor: string;
    readonly mode: ThemeMode;
    readonly logoUrl: string | null;
    readonly tagline: string | null;
  } | null;
}

export interface TenantStore {
  findBySubdomain(subdomain: string): Promise<TenantWithTheme | null>;
}

interface Row {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  primary_color: string | null;
  mode: ThemeMode | null;
  logo_url: string | null;
  tagline: string | null;
}

export function createPostgresTenantStore(sql: Sql): TenantStore {
  return {
    async findBySubdomain(subdomain) {
      const rows = await sql<Row[]>`
        select t.id, t.name, t.subdomain, t.status,
               th.primary_color, th.mode, th.logo_url, th.tagline
        from public.tenants t
        left join public.tenant_theme th on th.tenant_id = t.id
        where t.subdomain = ${subdomain}
        limit 1`;
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        status: row.status,
        theme:
          row.primary_color && row.mode
            ? {
                primaryColor: row.primary_color,
                mode: row.mode,
                logoUrl: row.logo_url,
                tagline: row.tagline,
              }
            : null,
      };
    },
  };
}

/** Implémentation en mémoire, pour les tests. */
export function createMemoryTenantStore(tenants: readonly TenantWithTheme[]): TenantStore {
  return {
    findBySubdomain: (subdomain) =>
      Promise.resolve(tenants.find((t) => t.subdomain === subdomain) ?? null),
  };
}
