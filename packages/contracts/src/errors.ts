import { z } from 'zod';

/** Format unique des erreurs de l'API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'not_found',
      'tenant_suspended',
      'invalid_request',
      'menu_unavailable',
      'internal_error',
    ]),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorCode = ApiError['error']['code'];
