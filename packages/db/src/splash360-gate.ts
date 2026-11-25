import type { Sql } from './client';

/**
 * Coordination des appels Splash360 entre instances du serveur (lot 19, ADR 0024).
 * Les clés sont des empreintes SHA-256 de l'identifiant client, calculées par `@splash360/api-menu`.
 */
export interface PostgresSplash360Gate {
  /**
   * Exécute `task` sous un verrou consultatif de transaction propre à l'identifiant client :
   * compatible avec le pooler en mode transaction (verrou libéré au commit). La transaction
   * englobe l'appel HTTP (10 s au plus) : elle occupe une connexion pendant ce temps.
   */
  exclusive<T>(clientKey: string, task: () => Promise<T>): Promise<T>;
  /** 0 si l'export des ventes est permis (et horodaté), sinon les millisecondes à attendre. */
  reserveSales(clientKey: string, minIntervalMs: number): Promise<number>;
}

/** `getSql` : connexion du moment (la fonction Edge en recrée au fil de ses générations). */
export function createPostgresSplash360Gate(getSql: () => Sql): PostgresSplash360Gate {
  return {
    async exclusive<T>(clientKey: string, task: () => Promise<T>): Promise<T> {
      let result: { value: T } | null = null;
      await getSql().begin(async (tx) => {
        // Au-delà, on abandonne plutôt que d'empiler des connexions en attente.
        await tx`set local lock_timeout = '30s'`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${`splash360:${clientKey}`}, 0))`;
        result = { value: await task() };
      });
      if (!result) throw new Error('Verrou Splash360 : transaction sans résultat');
      return (result as { value: T }).value;
    },

    async reserveSales(clientKey, minIntervalMs) {
      const seconds = minIntervalMs / 1000;
      const sql = getSql();
      // Mise à jour conditionnelle : la ligne est verrouillée, deux instances ne passent pas ensemble.
      const taken = await sql`
        insert into splash360_private.call_slots as s (client_key, last_sales_call_at)
        values (${clientKey}, now())
        on conflict (client_key) do update set last_sales_call_at = now()
          where s.last_sales_call_at <= now() - make_interval(secs => ${seconds})
        returning 1`;
      if (taken.length > 0) return 0;
      const [row] = await sql<{ wait: number }[]>`
        select greatest(0, ceil(extract(epoch from
          (last_sales_call_at + make_interval(secs => ${seconds}) - now())) * 1000))::int as wait
        from splash360_private.call_slots where client_key = ${clientKey}`;
      return Math.max(1, row?.wait ?? minIntervalMs);
    },
  };
}
