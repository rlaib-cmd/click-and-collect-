import type { AmbassadorEntryDto } from '@splash360/contracts';
import { describe, expect, it } from 'vitest';
import {
  displayHandle,
  formatCreditDate,
  handleForCopy,
  photoFeedback,
  progressIndex,
  stageLabel,
  ticketCheckLabel,
  ticketReadSummary,
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

describe('achat vérifié (lot 20)', () => {
  it('affiche l’état de la vérification du ticket photographié', () => {
    expect(ticketCheckLabel(entry({ ticketCheck: 'verified' }))).toBe('Achat vérifié');
    expect(ticketCheckLabel(entry({ ticketCheck: 'pending' }))).toBe(
      'Vérification du ticket en cours',
    );
    expect(ticketCheckLabel(entry({ ticketCheck: 'not_found' }))).toBe(
      'Ticket introuvable : vérification par le restaurant',
    );
    expect(ticketCheckLabel(entry({ ticketCheck: 'unverified' }))).toBeNull();
  });

  it('résume ce qui a été lu sur le ticket (identifiant raccourci), pour confirmation', () => {
    const read = {
      readable: true,
      ticketId: '6f1c1c2e-0000-4000-8000-00000000000b',
      date: '2026-11-24',
      time: '12:41',
      totalCents: 1230,
      token: 'r1.x.y',
    };
    expect(ticketReadSummary(read)).toBe('Ticket 6f1c1c2e… · 24/11/2026 à 12:41 · 12,30\u00a0€');
    expect(ticketReadSummary({ ...read, time: null, totalCents: null })).toBe(
      'Ticket 6f1c1c2e… · 24/11/2026',
    );
    expect(
      ticketReadSummary({
        readable: false,
        ticketId: null,
        date: null,
        time: null,
        totalCents: null,
        token: null,
      }),
    ).toBeNull();
  });
});
