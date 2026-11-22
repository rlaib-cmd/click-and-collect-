/**
 * Détermine le sous-domaine de l'enseigne à afficher (ADR 0004).
 * Fonction pure : testable sans React Native.
 */
export interface ResolveInput {
  readonly platform: 'web' | 'native';
  /** Variable de build EXPO_PUBLIC_TENANT (obligatoire sur mobile). */
  readonly buildTenant: string | undefined;
  /** Sur le web : nom d'hôte et paramètres de l'URL courante. */
  readonly hostname?: string | undefined;
  readonly search?: string | undefined;
  /** Le paramètre ?enseigne= n'est accepté qu'hors production. */
  readonly allowOverride: boolean;
  /** Dernier ?enseigne= vu dans cet onglet (la navigation retire le paramètre de l'URL). */
  readonly rememberedOverride?: string | null | undefined;
}

const SUBDOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'app', 'api', 'admin']);
/** Hébergements d'aperçu : le premier libellé est le nom du projet, pas une enseigne. */
const PREVIEW_HOSTS = ['.expo.app'];

function clean(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && SUBDOMAIN.test(v) ? v : null;
}

/** Valeur de ?enseigne= présente dans l'URL, à mémoriser pour l'onglet. */
export function overrideFromSearch(search: string | undefined): string | null {
  return clean(search ? new URLSearchParams(search).get('enseigne') : null);
}

export function resolveSubdomain(input: ResolveInput): string | null {
  if (input.platform === 'native') return clean(input.buildTenant);

  if (input.allowOverride) {
    const override =
      clean(input.search ? new URLSearchParams(input.search).get('enseigne') : null) ??
      clean(input.rememberedOverride);
    if (override) return override;
  }

  const host = input.hostname?.toLowerCase() ?? '';
  const labels = host.split('.');
  const isIp = /^[0-9.]+$/.test(host);
  const isPreview = PREVIEW_HOSTS.some((suffix) => host.endsWith(suffix));
  if (!isIp && !isPreview && labels.length >= 3) {
    const first = clean(labels[0]);
    if (first && !RESERVED.has(first)) return first;
  }

  return clean(input.buildTenant);
}
