# o11yFleet

o11yFleet is an OpAMP fleet-management service for OpenTelemetry Collectors. It
uses Cloudflare Workers for the API and OpAMP ingress, Durable Objects for live
collector state, D1 for relational data, R2 for config content, Queues for event
fanout, and React/Vite for the marketing site, customer portal, and admin UI.

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| just | latest | See [below](#installing-just) |
| Wrangler | latest | `npx wrangler login` |
| GitHub Account | — | [github.com](https://github.com) |

### Installing `just`

`just` is a command runner (like `make` but better). Install it:

```bash
# macOS/Linux via cargo
cargo install just

# Or via shell installer (Linux/macOS)
curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash

# Verify it works
just --version
```

### Setup (5 minutes)

```bash
# 1. Clone and enter the repo
git clone https://github.com/your-org/o11yfleet.git
cd o11yfleet

# 2. Install dependencies
just install

# 3. Set up local environment variables
cp apps/worker/.dev.vars.example apps/worker/.dev.vars

# 4. Authenticate with Cloudflare (opens browser)
npx wrangler login

# 5. Verify your environment is ready
just doctor

# 6. Start everything!
just dev-up
```

### What Just Dev-Up Does

`just dev-up` starts:
- **Worker API** at http://localhost:8787 (OpAMP + Management API)
- **Site UI** at http://127.0.0.1:3000 (Portal + Admin)

It also automatically:
- Replaces placeholder secrets with secure random values
- Applies D1 database migrations
- Seeds local dev data (tenant, config, enrollment token)
- Waits for services to be healthy

### Running Tests

```bash
# Run all fast tests (no live server needed)
just test

# Run only core package tests (fastest)
just test-core

# Run worker tests with workerd runtime
just test-runtime

# UI tests require Playwright browsers (one-time setup)
just playwright-install
just test-ui

# Full pre-PR gate
just ci-fast
```

### Common Tasks

| Task | Command |
|------|---------|
| Start fake collector | `just collector` |
| View fleet status | `just fleet` |
| Push config to agents | `just push-config` |
| Reset local database | `just dev-reset` |
| Lint all code | `just lint` |
| Type check all | `just typecheck` |
| Check code (changed files only) | `just check` |

### Troubleshooting

**`just: command not found`**
```bash
export PATH="$HOME/.local/bin:$PATH:$HOME/.cargo/bin:$PATH"
# Add the above to your ~/.bashrc or ~/.zshrc to make it permanent
```

**`wrangler login` fails**
Make sure you have permission to access the Cloudflare account. Contact a team member.

**`just doctor` fails with missing secrets**
The dev secrets script should auto-fill placeholders. If not, run:
```bash
just ensure-dev-secrets
```

**UI tests fail with "browser not found"**
Install Playwright browsers:
```bash
just playwright-install
```

## Hosted Environments

| Environment | API                                         | Site                             | Portal                                              | Admin                                                |
| ----------- | ------------------------------------------- | -------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Dev         | <https://dev-api.o11yfleet.com/healthz>     | <https://dev.o11yfleet.com/>     | <https://dev-app.o11yfleet.com/portal/overview>     | <https://dev-admin.o11yfleet.com/admin/overview>     |
| Staging     | <https://staging-api.o11yfleet.com/healthz> | <https://staging.o11yfleet.com/> | <https://staging-app.o11yfleet.com/portal/overview> | <https://staging-admin.o11yfleet.com/admin/overview> |
| Production  | <https://api.o11yfleet.com/healthz>         | <https://o11yfleet.com/>         | <https://app.o11yfleet.com/portal/overview>         | <https://admin.o11yfleet.com/admin/overview>         |

See [DEPLOY.md](DEPLOY.md) for deployment workflows, secrets, and CI smoke-test
details.

## Useful Commands

| Command                       | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `just dev-up`                 | Start the full local app loop          |
| `just dev-reset`              | Re-run local migrations and seed data  |
| `just check`                  | Run changed-file-aware checks          |
| `just ci-fast`                | Fast pre-PR gate                       |
| `just ci-pr`                  | Reproduce required PR checks locally   |
| `just reproduce-check <name>` | Run one GitHub check locally           |
| `just smoke-local`            | API + OpAMP lifecycle smoke test       |
| `just test-ui`                | Browser UI tests                       |
| `just pipeline-experiment`    | Pipeline graph/YAML experiment harness |

## Docs

- [Docs index](docs/README.md)
- [Development guide](DEVELOPING.md)
- [Deployment runbook](DEPLOY.md)
- [Architecture](docs/architecture/overview.md)
- [Product model](docs/product/model.md)
- [Pricing model](docs/product/pricing.md)
- [Pipeline management](docs/product/pipeline-management.md)
- [AI guidance](docs/product/ai-guidance.md)
