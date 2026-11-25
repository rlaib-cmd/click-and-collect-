import { describe, expect, it } from 'vitest';
import { displayHandle, handleForCopy, progressIndex } from './ambassador';

describe('ambassadeur', () => {
  it('copie le compte sans « @ » mais l’affiche avec', () => {
    expect(handleForCopy('@billsburgerfr')).toBe('billsburgerfr');
    expect(handleForCopy('billsburgerfr')).toBe('billsburgerfr');
    expect(handleForCopy(' @@billsburgerfr ')).toBe('billsburgerfr');
    expect(displayHandle('billsburgerfr')).toBe('@billsburgerfr');
  });

  it('place chaque étape sur la barre Ticket → Burger → Story', () => {
    expect(progressIndex('intro')).toBe(-1);
    expect(progressIndex('ticket')).toBe(0);
    expect(progressIndex('photo')).toBe(1);
    expect(progressIndex('story')).toBe(2);
    expect(progressIndex('sent')).toBe(2);
  });
});
