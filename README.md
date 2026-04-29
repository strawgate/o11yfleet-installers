# o11yFleet

OpAMP (Open Agent Management Protocol) fleet management built on Cloudflare's edge platform.

## Project Structure

```text
o11yfleet/
├── apps/
│   ├── worker/        # Cloudflare Worker (API + OpAMP ingress + Durable Objects)
│   ├── web/           # React management UI (Vite + React Router + TanStack Query)
│   └── site/          # Static marketing site (Cloudflare Pages)
├── packages/
│   ├── core/          # Pure TypeScript (OpAMP codec, state machine, auth)
│   ├── db/            # D1 migrations and schema
│   └── test-utils/    # Shared test utilities
├── infra/
│   └── terraform/     # Infrastructure as code
├── .github/workflows/ # CI/CD pipelines
└── justfile          # Developer commands
```

## Prerequisites

- **Node.js 22+**
- **pnpm 9+**
- [**just** command runner](https://github.com/casey/just) (`brew install just` on macOS)
- **Cloudflare Wrangler** (via `npx wrangler` or a global install)

## Quick Start

```bash
# Install dependencies
just install

# Set up local environment (creates apps/worker/.dev.vars)
cp apps/worker/.dev.vars.example apps/worker/.dev.vars

# Check environment readiness
just doctor

# Start worker locally (wrangler dev)
just dev

# In another terminal: migrate, seed, show fleet status
just setup

# Start web UI locally (separate terminal)
just ui

# Run tests
just test          # All tests
just test-core     # Core package only (fast)
just test-worker   # Worker tests (workerd runtime)
just test-e2e      # E2E tests (requires just dev running)
```

## Key Technologies

| Component       | Technology               |
| --------------- | ------------------------ |
| Runtime         | Cloudflare Workers       |
| Agent State     | Durable Objects (SQLite) |
| Relational Data | Cloudflare D1            |
| Config Storage  | Cloudflare R2            |
| Event Queue     | Cloudflare Queues        |
| UI              | React 19 + Vite          |
| CI/CD           | GitHub Actions           |

## Architecture

The system has three main planes:

1. **Agent Control Plane** — Durable Objects manage real-time agent connections, config delivery, health tracking
2. **Management API** — Worker-based REST API for tenant/config/token CRUD
3. **Auth Layer** — Session-based auth for portal, Bearer token for programmatic access

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

## Commands

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `just dev`             | Start worker locally                     |
| `just ui`              | Start web UI                             |
| `just setup`           | Migrate, seed, and show fleet status     |
| `just lint`            | Lint all packages                        |
| `just typecheck`       | Type check all packages                  |
| `just test`            | Run all tests                            |
| `just bench`           | Run benchmarks                           |
| `just load-test-smoke` | Quick load test (10 agents, 15s)         |
| `just load-test`       | Load test (configurable agents/duration) |
| `just bundle-size`     | Check worker bundle size                 |
| `just deploy-staging`  | Deploy to staging                        |
| `just tf-validate`     | Validate Terraform                       |

## CI Pipeline

- **lint-format** — ESLint + Prettier check
- **typecheck** — TypeScript type checking
- **test-core** — Core package tests (codec, state machine, auth)
- **test-worker** — Worker tests (workerd runtime)
- **bundle-size** — Worker bundle size validation (3MB compressed budget)
- **terraform** — Terraform validation
- **deploy-staging** — Deploy to staging with smoke tests

See [.github/workflows/ci.yml](.github/workflows/ci.yml) for full pipeline.

## Environment Variables

See `apps/worker/wrangler.jsonc` for local development variables.

Required secrets for production:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

## Resources

- [Architecture](docs/architecture.md)
- [Cloudflare Setup](infra/CLOUDFLARE_SETUP.md)
- [Portal Design](docs/portal-design-prompt.md)
