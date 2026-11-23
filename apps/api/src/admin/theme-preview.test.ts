import { describe, expect, it } from 'vitest';
import { createPreviewToken, isValidPreviewToken, PREVIEW_TTL_MS } from './theme-preview';

const now = new Date('2026-11-23T12:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);

describe('jeton d’aperçu du brouillon', () => {
  it('est valable pour son enseigne pendant 30 minutes', () => {
    const token = createPreviewToken('s', 'tenant-a', now);
    expect(isValidPreviewToken('s', 'tenant-a', token, now)).toBe(true);
    expect(isValidPreviewToken('s', 'tenant-a', token, later(PREVIEW_TTL_MS - 1))).toBe(true);
  });

  it('expire au bout de 30 minutes', () => {
    const token = createPreviewToken('s', 'tenant-a', now);
    expect(isValidPreviewToken('s', 'tenant-a', token, later(PREVIEW_TTL_MS))).toBe(false);
  });

  it('ne sert pas pour une autre enseigne ni avec un autre secret', () => {
    const token = createPreviewToken('s', 'tenant-a', now);
    expect(isValidPreviewToken('s', 'tenant-b', token, now)).toBe(false);
    expect(isValidPreviewToken('autre', 'tenant-a', token, now)).toBe(false);
  });

  it('refuse un jeton modifié, vide ou mal formé', () => {
    const token = createPreviewToken('s', 'tenant-a', now);
    const [exp, sig] = token.split('.');
    expect(isValidPreviewToken('s', 'tenant-a', `${Number(exp) + 1000}.${sig}`, now)).toBe(false);
    expect(isValidPreviewToken('s', 'tenant-a', undefined, now)).toBe(false);
    expect(isValidPreviewToken('s', 'tenant-a', 'n-importe-quoi', now)).toBe(false);
  });

  it('refuse une expiration trop lointaine', () => {
    const token = createPreviewToken('s', 'tenant-a', later(PREVIEW_TTL_MS * 4));
    expect(isValidPreviewToken('s', 'tenant-a', token, now)).toBe(false);
  });
});
