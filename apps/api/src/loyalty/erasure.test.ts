import type { LoyaltyProvider } from '@splash360/api-loyalty';
import { noLoyaltyProvider } from '@splash360/api-loyalty';
import { createMemoryMemberSessionStore, createMemoryStripeCustomerStore } from '@splash360/db';
import { describe, expect, it } from 'vitest';
import { createFakeCardGateway } from '../payments/cards';
import { CLIENT_ACTOR, eraseLoyaltyMember, type MemberErasureDeps } from './erasure';

const TENANT = { id: '00000000-0000-4000-8000-000000000001', splash360Id: 'S360-DEMO-BELLA' };
const MEMBER = '123456';

function setup(options: { exists?: boolean; failCards?: boolean } = {}) {
  const deleted: string[] = [];
  const steps: string[] = [];
  const audit: { action: string; actor: string; detail: unknown }[] = [];
  const loyalty: LoyaltyProvider = {
    ...noLoyaltyProvider,
    deleteMember: (_t, memberId) => {
      steps.push('member');
      if (options.exists === false || deleted.includes(memberId)) return Promise.resolve(false);
      deleted.push(memberId);
      return Promise.resolve(true);
    },
  };
  const cards = createFakeCardGateway();
  const customers = createMemoryStripeCustomerStore();
  const sessions = createMemoryMemberSessionStore();
  const deps: MemberErasureDeps = {
    loyalty,
    memberSessions: sessions,
    cardGateway: options.failCards
      ? { ...cards.gateway, detach: () => Promise.reject(new Error('Stripe indisponible')) }
      : cards.gateway,
    stripeCustomers: customers,
    proximity: {
      forgetMember: () => {
        steps.push('proximity');
        return Promise.resolve();
      },
    },
    ambassador: {
      forgetMember: () => {
        steps.push('ambassador');
        return Promise.resolve({ deletedEntries: 2, anonymisedEntries: 1 });
      },
    },
    audit: (e) => {
      audit.push({ action: e.action, actor: e.actor.email, detail: e.detail });
      return Promise.resolve();
    },
  };
  return { deps, cards, customers, sessions, steps, audit };
}

describe('effacement d’un membre (ADR 0028)', () => {
  it('détache les cartes, efface toutes les données liées, révoque les sessions, journalise', async () => {
    const s = setup();
    await s.customers.save(TENANT.id, MEMBER, 'cus_1');
    s.cards.addCard('cus_1', 'pm_1');
    s.cards.addCard('cus_1', 'pm_2');
    const result = await eraseLoyaltyMember(s.deps, TENANT, {}, MEMBER, CLIENT_ACTOR);
    expect(result).toEqual({ erased: true, partnerErasureRequested: false });
    expect(await s.cards.gateway.cardCustomer('pm_1')).toBeNull();
    expect(await s.cards.gateway.cardCustomer('pm_2')).toBeNull();
    expect(await s.customers.find(TENANT.id, MEMBER)).toBeNull();
    expect(s.steps).toEqual(['ambassador', 'proximity', 'member']);
    expect(await s.sessions.current(TENANT.id, MEMBER)).toBe(1);
    expect(s.audit).toEqual([
      {
        action: 'loyalty.member.delete',
        actor: 'client',
        detail: { cardsDetached: 2, ambassadorEntriesDeleted: 2, ambassadorEntriesAnonymised: 1 },
      },
    ]);
  });

  it('YouFID : effacement chez le partenaire demandé, sous 30 jours', async () => {
    const s = setup();
    const result = await eraseLoyaltyMember(
      s.deps,
      TENANT,
      { source: 'youfid' },
      MEMBER,
      CLIENT_ACTOR,
    );
    expect(result).toEqual({ erased: true, partnerErasureRequested: true });
    expect(s.audit.map((a) => a.action)).toEqual([
      'loyalty.member.delete',
      'loyalty.erasure_requested',
    ]);
    expect(s.audit[1]?.detail).toEqual({ partner: 'youfid', dueWithinDays: 30 });
  });

  it('membre inconnu ou déjà effacé : rien journalisé, aucune session créée', async () => {
    const s = setup({ exists: false });
    const result = await eraseLoyaltyMember(s.deps, TENANT, {}, MEMBER, CLIENT_ACTOR);
    expect(result).toEqual({ erased: false, partnerErasureRequested: false });
    expect(s.audit).toEqual([]);
    expect(await s.sessions.current(TENANT.id, MEMBER)).toBe(0);
  });

  it('Stripe en échec : rien n’est effacé, la demande peut être refaite', async () => {
    const s = setup({ failCards: true });
    await s.customers.save(TENANT.id, MEMBER, 'cus_1');
    s.cards.addCard('cus_1', 'pm_1');
    await expect(eraseLoyaltyMember(s.deps, TENANT, {}, MEMBER, CLIENT_ACTOR)).rejects.toThrow(
      'Stripe indisponible',
    );
    expect(s.steps).toEqual([]);
    expect(await s.customers.find(TENANT.id, MEMBER)).toBe('cus_1');
    expect(s.audit).toEqual([]);
  });
});
