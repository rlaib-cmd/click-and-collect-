import postgres from 'postgres';

export type Sql = postgres.Sql;
/** Connexion ou transaction en cours. */
export type Queryable = postgres.Sql | postgres.TransactionSql;

/**
 * Connexion Postgres côté serveur (ADR 0003). Le rôle utilisé contourne la RLS :
 * chaque requête doit filtrer par tenant_id.
 */
export function createSql(databaseUrl: string, options: { max?: number } = {}): Sql {
  return postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Compatible avec le pooler Supabase en mode transaction.
    prepare: false,
    transform: { undefined: null },
  });
}
