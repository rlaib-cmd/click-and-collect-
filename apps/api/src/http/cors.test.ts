import { describe, expect, it } from 'vitest';
import { corsOriginsFrom } from './cors';

describe('origines web autorisées (CORS_ORIGINS)', () => {
  it('liste exacte, sans barre finale ; vide ou absente : toutes', () => {
    expect(
      corsOriginsFrom(' https://app.exemple.fr/ , https://admin.exemple.fr,pas une origine'),
    ).toEqual(['https://app.exemple.fr', 'https://admin.exemple.fr']);
    expect(corsOriginsFrom(undefined)).toBe('*');
    expect(corsOriginsFrom('  ')).toBe('*');
    expect(corsOriginsFrom('https://exemple.fr/chemin')).toBe('*');
  });
});
