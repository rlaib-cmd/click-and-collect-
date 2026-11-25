import type { AmbassadorEntryDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import {
  displayHandle,
  formatCreditDate,
  handleForCopy,
  photoFeedback,
  progressIndex,
  stageLabel,
} from './ambassador';

const entry = (over: Partial<AmbassadorEntryDto>): AmbassadorEntryDto => ({
  id: 'e1',
  status: 'pending',
  stage: 'pending',
  ticketRef: 'BB-1042',
  bonusPoints: 50,
  createdAt: '2026-11-25T10:00:00.000Z',
  mentionReceivedAt: null,
  creditDueAt: null,
  photoVerdict: 'accepted',
  decidedAt: null,
  ticketCheck: 'unverified',
  ...over,
});

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

  it('affiche la date du crédit à l’heure de Paris', () => {
    expect(formatCreditDate('2026-11-26T08:30:00.000Z')).toBe('jeu. 26 nov. à 09:30');
  });

  it('rend chaque étape lisible pour le client, sans promettre ce qui n’est pas fait', () => {
    expect(stageLabel(entry({}), 'Bills Burger')).toBe('En attente de la mention de Bills Burger');
    expect(stageLabel(entry({ stage: 'to_review' }), 'Bills Burger')).toBe(
      'Photo en cours de vérification par le restaurant',
    );
    expect(
      stageLabel(
        entry({ stage: 'mention_received', creditDueAt: '2026-11-26T08:30:00.000Z' }),
        'Bills Burger',
      ),
    ).toBe('Mention reçue — +50 points le jeu. 26 nov. à 09:30');
    expect(stageLabel(entry({ stage: 'credited' }), 'B')).toBe('+50 points crédités');
    expect(stageLabel(entry({ stage: 'rejected' }), 'B')).toBe('Participation refusée');
  });

  it('bloque seulement une photo refusée par l’analyse', () => {
    expect(photoFeedback('rejected', 'Bills Burger')).toEqual({
      text: 'On ne voit pas de produit Bills Burger sur ta photo… Reprends-la en montrant bien ton produit.',
      blocking: true,
    });
    expect(photoFeedback('accepted', 'B').blocking).toBe(false);
    expect(photoFeedback('doubtful', 'B').blocking).toBe(false);
    expect(photoFeedback('error', 'B').blocking).toBe(false);
  });
});
