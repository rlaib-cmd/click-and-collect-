import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresOtpStore } from './otp';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BILLS = '00000000-0000-4000-8000-000000000005';

describe.skipIf(!url)('Codes de connexion Postgres (lot 10)', () => {
  const sql = createSql(url ?? '', { max: 6 });
  const store = createPostgresOtpStore(sql);
  const phone = `+3367${`${Date.now()}`.slice(-7)}`;
  afterAll(async () => {
    await sql`delete from public.customer_otp_challenges where identifier = ${phone}`;
    await sql.end();
  });

  it('compte les essais sans dépasser le plafond, même en parallèle, et ne sert qu’une fois', async () => {
    const since = new Date(Date.now() - 60_000);
    await store.create(BILLS, {
      channel: 'sms',
      identifier: phone,
      codeHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect(await store.recentSends(BILLS, phone, since)).toHaveLength(1);
    const c = await store.latest(BILLS, 'sms', phone);
    expect(c).toMatchObject({ attempts: 0, verifiedAt: null, consumedAt: null });
    const id = c?.id ?? '';
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.recordAttempt(id, 5, false)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await store.latest(BILLS, 'sms', phone))?.attempts).toBe(5);
    expect(await store.latest(BILLS, 'email', phone)).toBeNull();
    const consumed = await Promise.all([store.consume(id), store.consume(id)]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
  });
});
