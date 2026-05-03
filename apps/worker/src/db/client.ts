// Kysely client factory for D1.
//
// Why Kysely (and not Drizzle): we are write-sensitive. Kysely is purely a
// type-safe query builder — every chained method maps 1:1 to one SQL
// statement. There's no relations API, no eager loading, no implicit JOIN
// expansion. What you write is what runs. Schema lives in `./schema.ts`
// (mirrors `packages/db/migrations/`); migrations stay as `.sql` files.
//
// Usage:
//
//   import { getDb } from "./db/client.js";
//
//   const db = getDb(env.FP_DB);
//   const tenant = await db
//     .selectFrom("tenants")
//     .selectAll()
//     .where("id", "=", id)
//     .executeTakeFirst();   // → undefined if no row
//
// Existing `env.FP_DB.prepare(...)` call sites continue to work; this is
// purely additive. New code should prefer Kysely; old code can migrate
// incrementally one route file at a time.

import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./schema.js";

export function getDb(d1: D1Database): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: d1 }),
  });
}
