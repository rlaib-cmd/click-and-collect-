import { apiErrorSchema, tenantConfigSchema, type TenantConfig } from '@splash360/contracts';

export type TenantLoadError = 'network' | 'not_found' | 'suspended';

export type TenantLoadResult =
  | { readonly ok: true; readonly config: TenantConfig }
  | { readonly ok: false; readonly error: TenantLoadError };

/** Charge la configuration de l'enseigne et vérifie qu'elle respecte le contrat. */
export async function fetchTenantConfig(
  apiUrl: string,
  subdomain: string,
  fetchImpl: typeof fetch = fetch,
  /** Jeton d'aperçu du brouillon de design (lien du back-office, lot 12). */
  previewToken: string | null = null,
): Promise<TenantLoadResult> {
  let res: Response;
  const query = previewToken ? `?preview=${encodeURIComponent(previewToken)}` : '';
  try {
    res = await fetchImpl(`${apiUrl}/v1/tenants/${encodeURIComponent(subdomain)}/config${query}`);
  } catch {
    return { ok: false, error: 'network' };
  }

  const json: unknown = await res.json().catch(() => null);

  if (res.ok) {
    const parsed = tenantConfigSchema.safeParse(json);
    return parsed.success ? { ok: true, config: parsed.data } : { ok: false, error: 'network' };
  }

  const err = apiErrorSchema.safeParse(json);
  if (err.success && err.data.error.code === 'tenant_suspended')
    return { ok: false, error: 'suspended' };
  if (res.status === 404 || res.status === 400) return { ok: false, error: 'not_found' };
  return { ok: false, error: 'network' };
}

/** Jeton d'aperçu présent dans l'adresse (`?preview=`), borné en taille ; null sinon. */
export function previewFromSearch(search: string | undefined): string | null {
  const token = search ? new URLSearchParams(search).get('preview') : null;
  return token && /^[0-9A-Za-z._-]{1,200}$/.test(token) ? token : null;
}
