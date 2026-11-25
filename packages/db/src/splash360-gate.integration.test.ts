import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from './client';
import { createPostgresSplash360Gate } from './splash360-gate';

/** Nécessite DATABASE_URL sur une base migrée. */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Splash360Gate Postgres (lot 19)', () => {
  const sql = createSql(url ?? '', { max: 4 });
  const gate = createPostgresSplash360Gate(() => sql);
  const key = `${Date.now().toString(16)}`.padStart(64, 'b');
  afterAll(async () => {
    await sql`delete from splash360_private.call_slots where client_key = ${key}`;
    await sql.end();
  });

  it('un seul export des ventes par minute, même pour deux demandes simultanées', async () => {
    const waits = await Promise.all([
      gate.reserveSales(key, 60_000),
      gate.reserveSales(key, 60_000),
    ]);
    expect(waits.filter((w) => w === 0)).toHaveLength(1);
    expect(Math.max(...waits)).toBeGreaterThan(50_000);
    await sql`update splash360_private.call_slots set last_sales_call_at = now() - interval '61 seconds'
      where client_key = ${key}`;
    expect(await gate.reserveSales(key, 60_000)).toBe(0);
  });

  it('exécute les tâches d’un même client l’une après l’autre', async () => {
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return 'ok';
    };
    const results = await Promise.all([
      gate.exclusive(key, task),
      gate.exclusive(key, task),
      gate.exclusive(key, task),
    ]);
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(maxActive).toBe(1);
  });
});
