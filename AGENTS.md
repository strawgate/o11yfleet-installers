# o11yFleet Agent Instructions

## Project Overview

OpAMP (Open Agent Management Protocol) fleet management built on Cloudflare Workers, Durable Objects, D1, R2, and Queues.

## Documentation Routing

| File                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `README.md`            | User-facing overview, quick start                   |
| `DEVELOPING.md`        | Architecture, design decisions, build/test commands |
| `docs/architecture.md` | Technical architecture details                      |
| `justfile`             | All developer commands                              |

## Key Commands

```bash
just dev         # Start worker locally
just setup       # Migrate, seed, and show fleet status
just ui          # Start web UI
just test        # Run all tests
just test-core   # Core package only (fast)
just test-worker # Worker tests (workerd runtime)
just lint        # Lint all packages
just typecheck   # Type check all packages
just bench       # Run benchmarks
```

## Package Structure

| Package                | Role                                              |
| ---------------------- | ------------------------------------------------- |
| `packages/core/`       | OpAMP codec, state machine, auth (pure TS, no CF) |
| `packages/db/`         | D1 migrations and schema                          |
| `packages/test-utils/` | Shared test utilities                             |
| `apps/worker/`         | Cloudflare Worker (API + OpAMP + DO)              |
| `apps/site/`           | React/Vite marketing site, user portal, admin UI  |
| `apps/web/`            | Legacy React management UI                        |

## Project-Specific Rules

- Worker code uses `@cloudflare/vitest-pool-workers` for tests
- Core package tests run in plain Vitest (no CF runtime needed)
- All packages use TypeScript with strict mode
- Config DO uses SQLite internally (not D1) for agent state
- Enroll tokens use HMAC-SHA256 signed claims (no JWT library needed)

## CI Pipeline

See `.github/workflows/ci.yml`:

- lint-format, typecheck, test-core, test-worker run in parallel
- bundle-size checks worker bundle (3MB compressed budget)
- terraform validates IaC
- deploy-staging runs smoke tests on push to main
