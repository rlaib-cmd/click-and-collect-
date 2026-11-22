import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresDemoLoyaltyStore } from './loyalty-demo';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BILLS = '00000000-0000-4000-8000-000000000005';

describe.skipIf(!url)('Fidélité de démonstration Postgres', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const store = createPostgresDemoLoyaltyStore(sql);
  const run = `${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.loyalty_demo_members where email like ${`%-${run}@example.fr`}`;
    await sql.end();
  });

  it('crée le membre une fois, crédite et consomme une seule fois par commande, même en parallèle', async () => {
    const input = {
      name: 'Test',
      email: `client-${run}@example.fr`,
      phone: null,
      cardCode: `S360-T${run}`,
      welcomePoints: 100,
    };
    const { member, created } = await store.createMember(BILLS, input);
    expect(created).toBe(true);
    expect((await store.createMember(BILLS, { ...input, cardCode: `X${run}` })).created).toBe(
      false,
    );

    const orderId = '30000000-0000-4000-8000-000000000001';
    const settle = () =>
      store.settle(BILLS, {
        memberId: member.id,
        orderId,
        earn: { points: 500, label: 'Commande' },
        redeem: { points: 100, label: 'Frites' },
      });
    const results = await Promise.all([settle(), settle(), settle()]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await store.getMember(BILLS, member.id))?.points).toBe(100 - 100 + 500);
    expect((await store.history(BILLS, member.id)).map((h) => h.kind).sort()).toEqual([
      'earn',
      'redeem',
      'welcome',
    ]);
    expect(
      await store.settle(BILLS, {
        memberId: member.id,
        orderId: '30000000-0000-4000-8000-000000000002',
        earn: null,
        redeem: { points: 9999, label: 'Trop cher' },
      }),
    ).toEqual({ ok: false, error: 'insufficient_points' });
    expect(await store.getMember('00000000-0000-4000-8000-000000000001', member.id)).toBeNull();
  });

  it('administre un membre : recherche, correction sans solde négatif, suppression', async () => {
    const { member } = await store.createMember(BILLS, {
      name: 'Admin Test',
      email: `admin-${run}@example.fr`,
      phone: null,
      cardCode: `S360-A${run}`,
      welcomePoints: 100,
    });
    expect((await store.listMembers(BILLS, `admin-${run}`, 10)).map((m) => m.id)).toEqual([
      member.id,
    ]);
    expect(await store.listMembers(BILLS, '%', 10)).toEqual([]);
    expect(await store.adjust(BILLS, member.id, -30, 'Correction')).toMatchObject({
      ok: true,
      member: { points: 70 },
    });
    expect(await store.adjust(BILLS, member.id, -71, 'Trop')).toEqual({
      ok: false,
      error: 'insufficient_points',
    });
    expect((await store.history(BILLS, member.id))[0]).toMatchObject({
      kind: 'adjust',
      points: -30,
    });
    expect(await store.deleteMember(BILLS, member.id)).toBe(true);
    expect(await store.getMember(BILLS, member.id)).toBeNull();
  });
});
