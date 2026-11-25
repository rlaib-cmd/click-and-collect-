import { DEFAULT_PROXIMITY_RULES } from '@splash360/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresProximityStore } from './proximity';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';
const GREEN = '00000000-0000-4000-8000-000000000002';
const TOKEN = (n: number) => `ExponentPushToken[proxi-${n}-${Date.now()}]`;
const H = 3_600_000;

describe.skipIf(!url)('Bons plans à proximité (lot 22)', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const store = createPostgresProximityStore(sql);
  const member = `8${String(Date.now()).slice(-9)}`;
  const other = `7${String(Date.now()).slice(-9)}`;
  let resto = '';
  let customerId = '';

  beforeAll(async () => {
    const [r] = await sql<{ id: string }[]>`
      select id from public.restaurants where tenant_id = ${BELLA} order by name limit 1`;
    resto = r?.id ?? '';
    const [c] = await sql<{ id: string }[]>`
      insert into public.customers (tenant_id, name, email, phone)
      values (${BELLA}, 'Proxi', ${`proxi-${member}@example.fr`}, '+33600000000')
      returning id`;
    customerId = c?.id ?? '';
  });

  afterAll(async () => {
    await sql`delete from public.proximity_events where member_id in (${member}, ${other})`;
    await sql`delete from public.proximity_devices where member_id in (${member}, ${other})`;
    await sql`delete from public.proximity_settings where tenant_id in (${BELLA}, ${GREEN})`;
    await sql`delete from public.orders where customer_id = ${customerId}`;
    await sql`delete from public.customers where id = ${customerId}`;
    await sql.end();
  });

  it('règles : défauts (désactivée), enregistrement, heures calmes au format HH:MM', async () => {
    expect(await store.getSettings(GREEN)).toEqual(DEFAULT_PROXIMITY_RULES);
    const rules = {
      ...DEFAULT_PROXIMITY_RULES,
      enabled: true,
      radiusMeters: 300,
      target: 'reward' as const,
      quietHours: { start: '22:30', end: '07:45' },
    };
    await store.saveSettings(BELLA, rules);
    expect(await store.getSettings(BELLA)).toEqual(rules);
    await store.saveSettings(BELLA, { ...rules, quietHours: null });
    expect((await store.getSettings(BELLA)).quietHours).toBeNull();
    expect(await store.getSettings(GREEN)).toEqual(DEFAULT_PROXIMITY_RULES);
  });

  it('appareils : inscription, reprise par un autre membre, retrait ciblé ou complet', async () => {
    const a = TOKEN(1);
    const b = TOKEN(2);
    await store.registerDevice(BELLA, member, a, 'ios');
    await store.registerDevice(BELLA, member, b, 'android');
    expect((await store.memberTokens(BELLA, member)).sort()).toEqual([a, b].sort());
    expect(await store.memberTokens(GREEN, member)).toEqual([]);
    // Même téléphone, autre membre connecté : le jeton change de propriétaire.
    await store.registerDevice(BELLA, other, b, 'android');
    expect(await store.memberTokens(BELLA, member)).toEqual([a]);
    expect(await store.removeDevices(BELLA, member, b)).toBe(0);
    expect(await store.removeDevices(BELLA, other, null)).toBe(1);
    expect((await store.stats(BELLA, new Date())).optedInMembers).toBeGreaterThanOrEqual(1);
  });

  it('envoi réservé une seule fois, même en parallèle ; plafonds ; échec ; ouverture', async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * H);
    const claim = () =>
      store.claimSend({
        tenantId: BELLA,
        memberId: member,
        restaurantId: resto,
        at: now,
        memberSince: since,
        restaurantSince: since,
      });
    const ids = await Promise.all([claim(), claim(), claim()]);
    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    const id = ids.find((x) => x !== null) ?? '';
    expect(await store.lastSent(BELLA, member, resto)).toEqual({ member: now, restaurant: now });
    expect(await store.lastSent(GREEN, member, resto)).toEqual({ member: null, restaurant: null });

    await store.recordSkipped({
      tenantId: BELLA,
      memberId: member,
      restaurantId: resto,
      reason: 'member_cap',
      at: now,
    });
    expect(await store.markOpened(BELLA, other, id, now)).toBe(false);
    expect(await store.markOpened(GREEN, member, id, now)).toBe(false);
    expect(await store.markOpened(BELLA, member, id, now)).toBe(true);
    expect(await store.markOpened(BELLA, member, id, now)).toBe(false);
    expect(await store.markOpened(BELLA, member, 'pas-un-uuid', now)).toBe(false);

    // Restaurant d'une autre enseigne : refusé par la base.
    const [g] = await sql<{ id: string }[]>`
      select id from public.restaurants where tenant_id = ${GREEN} limit 1`;
    await expect(
      store.recordSkipped({
        tenantId: BELLA,
        memberId: member,
        restaurantId: g?.id ?? '',
        reason: 'closed',
        at: now,
      }),
    ).rejects.toThrow();

    // Un envoi en échec ne compte plus dans les plafonds.
    const later = new Date(now.getTime() + 25 * H);
    const id2 = await store.claimSend({
      tenantId: BELLA,
      memberId: member,
      restaurantId: resto,
      at: later,
      memberSince: new Date(later.getTime() - 24 * H),
      restaurantSince: new Date(later.getTime() - 24 * H),
    });
    expect(id2).not.toBeNull();
    await store.markFailed(BELLA, id2 ?? '');
    expect((await store.lastSent(BELLA, member, resto)).member).toEqual(now);
  });

  it('dernière commande et attribution des commandes dans les 2 h', async () => {
    expect(await store.lastOrderAt(BELLA, member)).toBeNull();
    const [sent] = await sql<{ created_at: Date }[]>`
      select created_at from public.proximity_events
      where member_id = ${member} and decision = 'sent' limit 1`;
    const at = new Date((sent?.created_at ?? new Date()).getTime() + 30 * 60_000);
    let n = 900_000 + Math.floor(Math.random() * 90_000);
    const order = (status: string, createdAt: Date) =>
      sql`insert into public.orders (tenant_id, restaurant_id, customer_id, number, mode, status,
            estimated_at, subtotal_cents, delivery_fee_cents, service_fee_cents, total_cents,
            idempotency_key, loyalty_member_id, created_at)
          values (${BELLA}, ${resto}, ${customerId}, ${n++}, 'pickup', ${status}, ${createdAt},
            1000, 0, 0, 1000, ${`proxi-${member}-${n}`}, ${member}, ${createdAt})`;
    await order('pending_payment', at);
    expect(await store.lastOrderAt(BELLA, member)).toBeNull();
    await order('paid', at);
    expect(await store.lastOrderAt(BELLA, member)).toEqual(at);
    const stats = await store.stats(BELLA, new Date(Date.now() + 26 * H));
    expect(stats.last7Days).toMatchObject({ sent: 1, opened: 1, orders: 1 });
    expect(stats.last30Days.sent).toBe(1);
  });

  it('purge au-delà de 90 jours et effacement d’un membre', async () => {
    const count = async () =>
      (
        await sql<{ n: number }[]>`
          select count(*)::int as n from public.proximity_events where member_id = ${member}`
      )[0]?.n ?? 0;
    const before = await count();
    await store.recordSkipped({
      tenantId: BELLA,
      memberId: member,
      restaurantId: resto,
      reason: 'closed',
      at: new Date(Date.now() - 91 * 24 * H),
    });
    expect(await store.purge(new Date(Date.now() - 90 * 24 * H))).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(before);
    expect(before).toBeGreaterThan(0);
    await store.forgetMember(BELLA, member);
    expect(await count()).toBe(0);
    expect(await store.memberTokens(BELLA, member)).toEqual([]);
  });
});
