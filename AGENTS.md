# o11yFleet Agent Instructions

## Project Overview

OpAMP (Open Agent Management Protocol) fleet management on Cloudflare Workers, Durable Objects, D1, R2, and Queues.

## Documentation Routing

| File            | Purpose                                      |
| --------------- | -------------------------------------------- |
| `README.md`     | User-facing overview                         |
| `DEVELOPING.md` | Developer workflow, build, test, package map |
| `CODE_STYLE.md` | Style preferences for reviewers              |
| `docs/`         | Architecture docs, design decisions          |
| `TESTING.md`    | Testing strategies and test maintenance      |

## Essential Commands

```bash
just dev-up      # Start everything (Worker + Site, migrate, seed) - USE THIS FIRST
just dev         # Worker only (port 8787)
just ui          # Site only (port 3000) - frontend only, no API
just check       # Changed-file-aware checks
just ci-fast     # Pre-push gate (lint + typecheck + test)
just fmt         # Format code before committing
just test-ui     # Playwright browser tests (after UI changes)
just playwright-install  # One-time setup for UI tests
```

## Package Structure

| Package                | Role                                               |
| ---------------------- | -------------------------------------------------- |
| `packages/core/`       | OpAMP codec, state machine, auth (pure TS, no CF)  |
| `packages/db/`         | D1 migrations + Kysely schema (single type-source) |
| `packages/test-utils/` | Shared test fixtures and FakeOpampAgent            |
| `apps/worker/`         | Cloudflare Worker (API + OpAMP + DO)               |
| `apps/site/`           | React/Vite portal and admin UI                     |

## Key Rules

- Use `just dev-up` NOT `pnpm dev` - `pnpm dev` is frontend-only
- Run `just test-ui` for ANY UI changes (Playwright tests)
- Run `just fmt` before every commit
- Config DO uses SQLite internally (not D1) for agent state
- Worker runtime tests use `@cloudflare/vitest-pool-workers`
- Core tests run in plain Vitest (no CF runtime)
