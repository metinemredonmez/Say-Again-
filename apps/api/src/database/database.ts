import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** The injected database. PGlite (tests) exposes the same query API. */
export type Database = NodePgDatabase;

/** A database or an open transaction. */
export type Executor =
  Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** PostgreSQL unique_violation, from node-postgres and PGlite alike (also wrapped in `cause`). */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (
      typeof current === 'object' &&
      (current as { code?: unknown }).code === '23505'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
