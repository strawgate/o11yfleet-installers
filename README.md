# o11yFleet

o11yFleet is an OpAMP fleet-management service for OpenTelemetry Collectors. It
uses Cloudflare Workers for the API and OpAMP ingress, Durable Objects for live
collector state, D1 for relational data, R2 for config content, Queues for event
fanout, and React/Vite for the marketing site, customer portal, and admin UI.

## Quick Start

Prerequisites: Node.js 22+, pnpm 9+, `just`, and Wrangler.

```bash
just install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
$EDITOR apps/worker/.dev.vars # replace dev-local placeholders
just doctor
just dev-up
```

`just dev-up` starts the Worker and site, waits for `/healthz`, applies local D1
migrations, seeds local data, and keeps both dev servers attached.

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
