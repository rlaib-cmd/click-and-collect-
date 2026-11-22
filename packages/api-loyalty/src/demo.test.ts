import { describe, expect, it } from 'vitest';
import { createDemoLoyaltyProvider, createMemoryDemoLoyaltyStore } from './demo';

const bills = { id: 't-bills', splash360Id: 'S360-DEMO-BILLS' };
const other = { id: 't-other', splash360Id: 'S360-DEMO-BILLS' };

describe('fidélité de démonstration', () => {
  it('donne le programme Bills Burger et aucun programme aux autres enseignes', async () => {
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => 'abc-def-123-456-789',
    );
    expect((await loyalty.getProgram(bills))?.pointsPerEuro).toBe(10);
    expect(await loyalty.getProgram({ id: 'x', splash360Id: 'S360-DEMO-BELLA' })).toBeNull();
  });

  it('crée le compte avec 100 points de bienvenue, une seule fois par e-mail et par enseigne', async () => {
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => 'abc-def-123-456-789',
    );
    const first = await loyalty.join(bills, {
      name: 'Ramzi',
      email: ' Ramzi@Example.fr ',
      phone: null,
    });
    expect(first).toMatchObject({
      created: true,
      member: { points: 100, email: 'ramzi@example.fr' },
    });
    expect(first.member.cardCode).toBe('S360-ABCDEF123456');
    const again = await loyalty.join(bills, {
      name: 'Autre',
      email: 'ramzi@example.fr',
      phone: null,
    });
    expect(again).toMatchObject({ created: false, member: { id: first.member.id } });
    // Même e-mail dans une autre enseigne : un autre compte.
    expect(
      (await loyalty.join(other, { name: 'R', email: 'ramzi@example.fr', phone: null })).created,
    ).toBe(true);
  });

  it('crédite les points et consomme la récompense une seule fois par commande', async () => {
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => 'abc-def-123-456-789',
    );
    const { member } = await loyalty.join(bills, { name: 'R', email: 'r@example.fr', phone: null });
    await loyalty.settleOrder(bills, {
      memberId: member.id,
      orderId: 'o1',
      orderNumber: 1002,
      earnPoints: 400,
      reward: null,
    });
    const settlement = {
      memberId: member.id,
      orderId: 'o2',
      orderNumber: 1003,
      earnPoints: 181,
      reward: { id: 'rw-bb-frites', name: 'Frites', costPoints: 400 },
    };
    expect(await loyalty.settleOrder(bills, settlement)).toEqual({ ok: true });
    expect(await loyalty.settleOrder(bills, settlement)).toEqual({ ok: true });
    expect((await loyalty.getMember(bills, member.id))?.points).toBe(100 + 400 - 400 + 181);
    const history = await loyalty.history(bills, member.id);
    expect(history.map((h) => [h.kind, h.points])).toEqual([
      ['earn', 181],
      ['redeem', -400],
      ['earn', 400],
      ['welcome', 100],
    ]);
  });

  it('refuse une récompense sans assez de points et un membre inconnu', async () => {
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => 'abc-def-123-456-789',
    );
    const { member } = await loyalty.join(bills, { name: 'R', email: 'r@example.fr', phone: null });
    const reward = { id: 'rw-bb-tasty', name: 'Tasty', costPoints: 1600 };
    expect(
      await loyalty.settleOrder(bills, {
        memberId: member.id,
        orderId: 'o',
        orderNumber: 1,
        earnPoints: 0,
        reward,
      }),
    ).toEqual({ ok: false, error: 'insufficient_points' });
    expect(
      await loyalty.settleOrder(other, {
        memberId: member.id,
        orderId: 'o',
        orderNumber: 1,
        earnPoints: 10,
        reward: null,
      }),
    ).toEqual({ ok: false, error: 'unknown_member' });
  });

  it('administre les membres : recherche, ajustement sans solde négatif, suppression', async () => {
    let n = 0;
    const loyalty = createDemoLoyaltyProvider(
      createMemoryDemoLoyaltyStore(),
      () => `code${++n}-aaaa-bbbb-cccc`,
    );
    const a = (await loyalty.join(bills, { name: 'Alice', email: 'a@x.fr', phone: null })).member;
    await loyalty.join(bills, { name: 'Bob', email: 'b@x.fr', phone: null });
    await loyalty.join(other, { name: 'Alice', email: 'a@x.fr', phone: null });
    expect((await loyalty.listMembers(bills, null, 10)).map((m) => m.name)).toEqual([
      'Bob',
      'Alice',
    ]);
    expect((await loyalty.listMembers(bills, ' ALI ', 10)).map((m) => m.id)).toEqual([a.id]);
    expect(await loyalty.adjustPoints(bills, a.id, 50, 'Geste commercial')).toMatchObject({
      ok: true,
      member: { points: 150 },
    });
    expect(await loyalty.adjustPoints(bills, a.id, -151, 'Erreur')).toEqual({
      ok: false,
      error: 'insufficient_points',
    });
    expect(await loyalty.adjustPoints(other, a.id, 10, 'x')).toEqual({
      ok: false,
      error: 'unknown_member',
    });
    await expect(loyalty.adjustPoints(bills, a.id, 0, 'x')).rejects.toThrow();
    expect((await loyalty.history(bills, a.id))[0]).toMatchObject({ kind: 'adjust', points: 50 });
    expect(await loyalty.deleteMember(other, a.id)).toBe(false);
    expect(await loyalty.deleteMember(bills, a.id)).toBe(true);
    expect(await loyalty.getMember(bills, a.id)).toBeNull();
  });
});
