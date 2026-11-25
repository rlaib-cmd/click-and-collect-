'use client';

import { messages } from '@splash360/i18n';
import { ApiError, ContractError } from '@/lib/api';

const t = messages.admin.common;

/**
 * Lecture suspendue après une erreur (audit du 25/11, F02) : la cause est affichée et la reprise
 * n'a lieu que sur un clic. Une session refusée (401) renvoie déjà à la connexion.
 */
export function LoadError({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  if (!error) return null;
  const detail =
    error instanceof ContractError
      ? t.badResponse
      : error instanceof ApiError && error.status === 429 && error.retryAfterSeconds !== null
        ? t.tooManyRequests(error.retryAfterSeconds)
        : error.message || t.error;
  return (
    <div className="banner danger" role="alert">
      <p style={{ margin: 0 }}>
        {t.loadFailed} {detail}
      </p>
      <button type="button" className="link" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  );
}
