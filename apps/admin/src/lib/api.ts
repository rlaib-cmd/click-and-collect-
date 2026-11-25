'use client';

import { apiErrorSchema } from '@splash360/contracts';
import type { z } from 'zod';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

/**
 * Version du back-office annoncée à l'API. Un onglet resté sur une ancienne version (boucle de
 * requêtes du 24/11) ne l'envoie pas : l'API le fait patienter puis lui demande de recharger.
 */
export const CLIENT_HEADER = 'X-Splash360-Client';
export const CLIENT_VERSION = 'back-office-2';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Délai demandé par le serveur avant tout nouvel essai (en-tête Retry-After, en secondes). */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

/** Réponse hors contrat (JSON illisible ou schéma non respecté) : on ne relit pas en boucle. */
export class ContractError extends Error {
  constructor(readonly path: string) {
    super(`Réponse inattendue du serveur (${path})`);
  }
}

/** Délai maximal d'une requête du back-office. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Signal annulé par l'appelant OU au bout du délai maximal. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Délai dépassé', 'TimeoutError')),
    ms,
  );
  const stop = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop, { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

export interface Auth {
  readonly token: string;
  readonly tenantId: string | null;
}

/** Appel à l'API du back-office ; la réponse est validée par le contrat. */
export async function api<T extends z.ZodType>(
  auth: Auth,
  path: string,
  schema: T,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<z.infer<T>> {
  const res = await fetch(`${API_URL}/v1/admin${path}`, {
    signal: withTimeout(init.signal, REQUEST_TIMEOUT_MS),
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      [CLIENT_HEADER]: CLIENT_VERSION,
      ...(auth.tenantId ? { 'X-Tenant-Id': auth.tenantId } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      res.status,
      err.success ? err.data.error.code : 'internal_error',
      err.success ? err.data.error.message : res.statusText,
      retryAfter(res),
    );
  }
  const raw: unknown = res.status === 204 ? undefined : await res.json().catch(() => INVALID);
  const parsed = raw === INVALID ? null : schema.safeParse(raw);
  if (!parsed?.success) throw new ContractError(path);
  return parsed.data as z.infer<T>;
}

const INVALID = Symbol('json-invalide');

/** Téléchargement d'un fichier (export CSV). */
export async function download(auth: Auth, path: string, filename: string) {
  const res = await fetch(`${API_URL}/v1/admin${path}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      [CLIENT_HEADER]: CLIENT_VERSION,
      ...(auth.tenantId ? { 'X-Tenant-Id': auth.tenantId } : {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, 'download_failed', res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const euros = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);

export const toCents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
export const fromCents = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

/** Envoi d'un fichier brut (logo du studio design) ; la réponse est validée par le contrat. */
export async function upload<T extends z.ZodType>(
  auth: Auth,
  path: string,
  file: Blob,
  schema: T,
): Promise<z.infer<T>> {
  const res = await fetch(`${API_URL}/v1/admin${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      [CLIENT_HEADER]: CLIENT_VERSION,
      ...(auth.tenantId ? { 'X-Tenant-Id': auth.tenantId } : {}),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(await res.json().catch(() => null));
    throw new ApiError(
      res.status,
      err.success ? err.data.error.code : 'internal_error',
      err.success ? err.data.error.message : res.statusText,
    );
  }
  return schema.parse(await res.json());
}

/** Adresse publique de l'application client (lien d'aperçu du brouillon). */
export const CLIENT_APP_URL = (
  process.env.NEXT_PUBLIC_CLIENT_APP_URL ?? 'http://localhost:8081'
).replace(/\/+$/, '');
