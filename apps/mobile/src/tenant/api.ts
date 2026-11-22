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
): Promise<TenantLoadResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiUrl}/v1/tenants/${encodeURIComponent(subdomain)}/config`);
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
