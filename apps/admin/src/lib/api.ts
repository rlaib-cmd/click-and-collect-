'use client';

import { apiErrorSchema } from '@splash360/contracts';
import type { z } from 'zod';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
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
  init: { method?: string; body?: unknown } = {},
): Promise<z.infer<T>> {
  const res = await fetch(`${API_URL}/v1/admin${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
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
    );
  }
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(await res.json());
}

/** Téléchargement d'un fichier (export CSV). */
export async function download(auth: Auth, path: string, filename: string) {
  const res = await fetch(`${API_URL}/v1/admin${path}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
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
