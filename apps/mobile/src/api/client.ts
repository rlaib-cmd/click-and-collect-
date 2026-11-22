import { apiErrorSchema, type ApiErrorCode } from '@splash360/contracts';
import type { z } from 'zod';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'network' | 'invalid_response',
    readonly status: number | null,
  ) {
    super(`Requête API en échec : ${code}`);
    this.name = 'ApiRequestError';
  }
}

/** Appel GET typé : la réponse est validée par le contrat avant d'être utilisée. */
export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
  fetchImpl: typeof fetch = fetch,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_URL}${path}`);
  } catch {
    throw new ApiRequestError('network', null);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(json);
    throw new ApiRequestError(err.success ? err.data.error.code : 'internal_error', res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiRequestError('invalid_response', res.status);
  return parsed.data;
}
