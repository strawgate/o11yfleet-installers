# o11yFleet

OpAMP (Open Agent Management Protocol) fleet management built on Cloudflare's edge platform.

## Project Structure

```text
o11yfleet/
├── apps/
│   ├── worker/        # Cloudflare Worker (API + OpAMP ingress + Durable Objects)
│   └── site/          # React app: marketing site, user portal, admin console
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

# Replace dev-local... placeholder secrets with local random values
$EDITOR apps/worker/.dev.vars

# Check environment readiness
just doctor

# Start worker + apps/site, run migrations, and seed local data
just dev-up

# Run tests
just check         # Changed-file-aware local check
just ci-fast       # Fast pre-PR gate
just test          # All tests
just test-core     # Core package only (fast)
just test-worker   # Worker tests (workerd runtime)
just smoke-local   # API + OpAMP lifecycle smoke test
just test-ui       # Browser UI tests
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

| Command                       | Description                              |
| ----------------------------- | ---------------------------------------- |
| `just dev-up`                 | Start worker + apps/site, migrate, seed  |
| `just dev-reset`              | Re-run local migrations and reset seed   |
| `just dev`                    | Start only the Worker                    |
| `just ui`                     | Start only apps/site                     |
| `just setup`                  | Migrate, seed, and show fleet status     |
| `just check`                  | Changed-file-aware local check           |
| `just check-json`             | Print changed-file check plan as JSON    |
| `just ci-fast`                | Fast local CI gate                       |
| `just ci-pr`                  | Reproduce required PR checks locally     |
| `just reproduce-check <name>` | Run one named GitHub check locally       |
| `just lint`                   | Lint all packages                        |
| `just typecheck`              | Type check all packages                  |
| `just test`                   | Run all tests                            |
| `just smoke-local`            | Local API + OpAMP lifecycle smoke test   |
| `just bench`                  | Run benchmarks                           |
| `just load-test-smoke`        | Quick load test (10 agents, 15s)         |
| `just load-test`              | Load test (configurable agents/duration) |
| `just bundle-size`            | Check worker bundle size                 |
| `just deploy-staging`         | Deploy to staging                        |
| `just tf-validate`            | Validate Terraform                       |

## CI Pipeline

- **lint-format** — ESLint + Prettier check
- **typecheck** — TypeScript type checking
- **test-core** — Core package tests (codec, state machine, auth)
- **test-worker** — Worker tests (workerd runtime)
- **bundle-size** — Worker bundle size validation (3MB compressed budget)
- **terraform** — Terraform validation
- **deploy-staging** — Deploy to staging with smoke tests

See the GitHub Actions workflow at [.github/workflows/ci.yml](.github/workflows/ci.yml) and
[docs/dev-loop.md](docs/dev-loop.md) for local check-name mappings.

## Environment Variables

See [DEPLOY.md](DEPLOY.md) for deployment credentials, Worker runtime secrets, and the
Cloudflare analytics variables that power the admin usage page.

## Resources

- [Architecture](docs/architecture.md)
- [Deployment](DEPLOY.md)
- [Cloudflare Setup](infra/CLOUDFLARE_SETUP.md)
- [Portal Design](docs/portal-design-prompt.md)
