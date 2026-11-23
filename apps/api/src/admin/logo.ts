import { createHash } from 'node:crypto';

/** Taille maximale d'un logo téléversé (lot 12). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type LogoFormat = 'png' | 'jpeg' | 'webp';

export const LOGO_CONTENT_TYPES: Record<LogoFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

/**
 * Format réel de l'image, d'après ses premiers octets (jamais d'après le nom ou le type annoncé).
 * Le SVG est refusé : il peut contenir du script.
 */
export function sniffLogo(bytes: Uint8Array): LogoFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}

export type LogoCheck =
  | { readonly ok: true; readonly format: LogoFormat }
  | { readonly ok: false; readonly error: 'logo_empty' | 'logo_too_large' | 'logo_unsupported' };

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: 'logo_empty' };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: 'logo_too_large' };
  const format = sniffLogo(bytes);
  return format ? { ok: true, format } : { ok: false, error: 'logo_unsupported' };
}

/** Chemin de stockage : dossier de l'enseigne, nom tiré du contenu (pas d'écrasement, cache sûr). */
export function logoPath(tenantId: string, bytes: Uint8Array, format: LogoFormat): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  return `${tenantId}/logo-${hash}.${format === 'jpeg' ? 'jpg' : format}`;
}

/** Stockage des fichiers de marque (Supabase Storage côté serveur). */
export interface AssetStorage {
  /** Dépose le fichier et renvoie son adresse publique. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

/** Supabase Storage, bucket public `brand-assets`, clé de service côté serveur uniquement. */
export function createSupabaseAssetStorage(opts: {
  readonly url: string;
  readonly serviceKey: string;
  readonly bucket?: string;
  readonly fetchImpl?: typeof fetch;
}): AssetStorage {
  const bucket = opts.bucket ?? 'brand-assets';
  const base = opts.url.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async put(path, bytes, contentType) {
      const res = await doFetch(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.serviceKey}`,
          apikey: opts.serviceKey,
          'Content-Type': contentType,
          'Cache-Control': 'max-age=31536000',
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`Stockage du logo en échec (${res.status})`);
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    },
  };
}

/** Stockage en mémoire (tests). */
export function createMemoryAssetStorage(base = 'https://cdn.test/brand-assets') {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: AssetStorage = {
    put(path, bytes, contentType) {
      files.set(path, { bytes, contentType });
      return Promise.resolve(`${base}/${path}`);
    },
  };
  return { storage, files };
}
