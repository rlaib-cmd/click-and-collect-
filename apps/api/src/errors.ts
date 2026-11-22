import type { ApiError, ApiErrorCode, OrderIssue } from '@splash360/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  tenant_suspended: 403,
  invalid_request: 400,
  menu_unavailable: 503,
  order_invalid: 422,
  slot_full: 409,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  payments_unavailable: 503,
  order_not_payable: 409,
  internal_error: 500,
};

export function apiError(
  c: Context,
  code: ApiErrorCode,
  message: string,
  issues?: readonly OrderIssue[],
) {
  const body: ApiError = { error: { code, message, ...(issues ? { issues: [...issues] } : {}) } };
  return c.json(body, STATUS[code]);
}
