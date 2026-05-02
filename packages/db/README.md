# @o11yfleet/db

D1 schema and migrations for the o11yfleet Worker.

## Layout

- `src/schema.ts` — TypeScript row types (mirror `migrations/0001_initial.sql`)
- `migrations/0001_initial.sql` — single baseline migration covering every table

## Why one migration

Pre-launch project. Migrations 0001–0008 were squashed into a single baseline
once we knew there were no users on any environment. New schema work goes in
new migrations (`0002_*.sql`, `0003_*.sql`, …) on top of this baseline.

## Resetting an existing D1 database

A D1 database that already ran the old 0001–0008 migrations needs to be wiped
before this baseline can apply, because every `CREATE TABLE` here uses
`IF NOT EXISTS` and an existing table won't be re-created with the new shape.

### Local dev

```bash
# Drop everything in the local SQLite mirror
cd apps/worker
pnpm wrangler d1 execute fp-db --local --command "
  DROP TABLE IF EXISTS d1_migrations;
  DROP TABLE IF EXISTS pending_tokens;
  DROP TABLE IF EXISTS auth_identities;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS agent_summaries;
  DROP TABLE IF EXISTS enrollment_tokens;
  DROP TABLE IF EXISTS config_versions;
  DROP TABLE IF EXISTS configurations;
  DROP TABLE IF EXISTS tenants;
"
pnpm wrangler d1 migrations apply fp-db --local
```

### Remote (dev / staging / prod)

```bash
# Replace fp-db with the env-specific name (o11yfleet-dev-db, o11yfleet-staging-db, fp-db).
DB_NAME=o11yfleet-dev-db
cd apps/worker
pnpm wrangler d1 execute "$DB_NAME" --remote --command "
  DROP TABLE IF EXISTS d1_migrations;
  DROP TABLE IF EXISTS pending_tokens;
  DROP TABLE IF EXISTS auth_identities;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS agent_summaries;
  DROP TABLE IF EXISTS enrollment_tokens;
  DROP TABLE IF EXISTS config_versions;
  DROP TABLE IF EXISTS configurations;
  DROP TABLE IF EXISTS tenants;
"
pnpm wrangler d1 migrations apply "$DB_NAME" --remote
```

After reset, re-seed dev with `just seed-reset`.
