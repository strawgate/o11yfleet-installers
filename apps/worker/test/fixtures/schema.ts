/**
 * Schema bootstrap for D1-backed tests.
 *
 * Loads the actual production migrations from `packages/db/migrations/` via
 * the `TEST_MIGRATIONS` binding (populated in `vitest.config.ts` using
 * `readD1Migrations`) and applies them with `applyD1Migrations()`. This is
 * the single source of truth — tests that previously hand-rolled CREATE TABLE
 * statements should call `bootstrapSchema()` instead so the test schema can
 * never drift from production.
 *
 * Idempotent: `applyD1Migrations()` records progress in a
 * `d1_migrations` tracking table and skips already-applied migrations,
 * so calling this from every `beforeAll` is safe.
 */

import { applyD1Migrations, env } from "cloudflare:test";

interface TestEnv {
  FP_DB: D1Database;
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

export async function bootstrapSchema(db: D1Database = env.FP_DB): Promise<void> {
  await applyD1Migrations(db, (env as unknown as TestEnv).TEST_MIGRATIONS);
}
