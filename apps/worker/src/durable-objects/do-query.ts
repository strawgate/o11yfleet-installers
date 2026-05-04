// Kysely query builder for DO-local SQLite.
//
// Uses DummyDriver so Kysely never opens a real connection — it only
// compiles type-safe SQL. Callers run the compiled {sql, parameters}
// against the synchronous SqlStorage API themselves.
//
// This decouples query building (async Kysely internals) from execution
// (sync SqlStorage.exec()) and avoids the sync/async mismatch entirely.

import {
  Kysely,
  DummyDriver,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import type { DoDatabase } from "./do-sqlite-schema.js";

/** Compile-only Kysely instance — never executes queries. */
export const doDb = new Kysely<DoDatabase>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

/** Compiled query shape produced by `.compile()`. */
export interface CompiledQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** Execute a compiled SELECT and return all rows. */
export function execQuery<T>(sql: SqlStorage, compiled: CompiledQuery): T[] {
  return sql.exec(compiled.sql, ...(compiled.parameters as unknown[])).toArray() as T[];
}

/** Execute a compiled SELECT and return the first row or null. */
export function execQueryOne<T>(sql: SqlStorage, compiled: CompiledQuery): T | null {
  const rows = execQuery<T>(sql, compiled);
  return rows[0] ?? null;
}

/** Execute a compiled INSERT / UPDATE / DELETE (ignores result set). */
export function execMutation(sql: SqlStorage, compiled: CompiledQuery): void {
  sql.exec(compiled.sql, ...(compiled.parameters as unknown[]));
}

/**
 * Execute a compiled INSERT / UPDATE / DELETE and return rowsWritten.
 * Useful for DELETE … WHERE patterns that need a count.
 */
export function execMutationCount(sql: SqlStorage, compiled: CompiledQuery): number {
  return sql.exec(compiled.sql, ...(compiled.parameters as unknown[])).rowsWritten;
}
