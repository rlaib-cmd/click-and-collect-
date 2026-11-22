import type { ApiError, ApiErrorCode } from '@splash360/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  tenant_suspended: 403,
  invalid_request: 400,
  internal_error: 500,
};

export function apiError(c: Context, code: ApiErrorCode, message: string) {
  const body: ApiError = { error: { code, message } };
  return c.json(body, STATUS[code]);
}
