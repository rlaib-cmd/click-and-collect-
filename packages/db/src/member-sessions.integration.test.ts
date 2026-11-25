import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresMemberSessionStore } from './member-sessions';

/** Nécessite DATABASE_URL sur une base migrée et chargée avec supabase/seed.sql. */
const url = process.env.DATABASE_URL;
const BELLA = '00000000-0000-4000-8000-000000000001';

describe.skipIf(!url)('Versions de session des membres (audit M4)', () => {
  const sql = createSql(url ?? '', { max: 2 });
  const sessions = createPostgresMemberSessionStore(sql);
  const member = `membre-${Date.now()}`;
  afterAll(async () => {
    await sql`delete from public.loyalty_member_sessions where member_id = ${member}`;
    await sql.end();
  });

  it('part de 0 et augmente à chaque connexion confirmée, même en parallèle', async () => {
    expect(await sessions.current(BELLA, member)).toBe(0);
    expect(await sessions.bump(BELLA, member)).toBe(1);
    const both = await Promise.all([sessions.bump(BELLA, member), sessions.bump(BELLA, member)]);
    expect(both.sort()).toEqual([2, 3]);
    expect(await sessions.current(BELLA, member)).toBe(3);
  });
});
