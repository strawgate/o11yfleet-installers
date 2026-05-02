# Development

Use this file for local development workflow and contribution mechanics. Put
system design in `docs/architecture/`, product language in `docs/product/`, and
deployment details in `DEPLOY.md`.

## Current Shape

o11yFleet has three runtime planes:

| Plane               | Owner  | Stores / APIs                                                                                                                         |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Agent control plane | Worker | `/v1/opamp`, per-`tenant:config` Durable Objects, DO SQLite, WebSockets                                                               |
| Management API      | Worker | `/api/v1/*`, `/api/admin/*`, D1 metadata, R2 config blobs, Queue events                                                               |
| Auth                | Worker | `/auth/*`, D1 users/sessions, HTTP-only `fp_session`, bearer `O11YFLEET_API_BEARER_SECRET` for bootstrap and tenant-scoped automation |

The customer portal and admin console call the real API. Remaining product gaps
are mostly depth: signup/password reset, team invites, richer RBAC, audit-event
UI, per-user API keys, progressive rollout state, and billing-provider wiring.

## Package Map

| Path                   | Role                                                      |
| ---------------------- | --------------------------------------------------------- |
| `apps/worker/`         | Cloudflare Worker, OpAMP ingress, API routes, DOs         |
| `apps/site/`           | React/Vite marketing site, customer portal, admin console |
| `apps/cli/`            | `ofleet` CLI                                              |
| `packages/core/`       | OpAMP codec, state machine, auth, AI and pipeline helpers |
| `packages/db/`         | D1 schema and migrations                                  |
| `packages/test-utils/` | Fake agents and shared test utilities                     |
| `tests/e2e/`           | API/OpAMP end-to-end tests                                |
| `tests/opamp/`         | OpAMP spec compliance tests (54/55 passing)               |
| `tests/e2e-collector/` | Real OTel Collector e2e + version matrix (Docker)         |
| `tests/ui/`            | Playwright browser tests                                  |
| `tests/load*/`         | Load and smoke-test harnesses                             |
| `infra/terraform/`     | Cloudflare infrastructure                                 |

## Local Loop

```bash
just install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
$EDITOR apps/worker/.dev.vars
just doctor
just dev-up
```

Useful variants:

| Command            | Use when                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `just dev`         | Start only the Worker                                                 |
| `just ui`          | Start only the site                                                   |
| `just dev-reset`   | Servers are running and local D1 needs reseeding                      |
| `just smoke-local` | Verify API + OpAMP lifecycle against the local Worker                 |
| `just check`       | Run only checks affected by changed, staged, and untracked files      |
| `just ci-fast`     | Run the fast local gate before pushing                                |
| `just ci-pr`       | Reproduce required PR checks, including slow browser/runtime coverage |

GitHub check mapping lives in [docs/development/dev-loop.md](docs/development/dev-loop.md).

## Testing Rules

- Prefer `just` commands over bare package-manager commands.
- `packages/core` tests run in plain Vitest.
- Worker runtime tests use `@cloudflare/vitest-pool-workers`.
- Browser coverage lives under `tests/ui`.
- Run `just docs-api-check` after changing API docs, public docs, route files, or
  route-heavy historical docs.
- Run `just sql-audit` after changing DO SQL helpers. Catches placeholder/binding
  count mismatches statically — the bug class behind PR #426's `upsertPendingDevice`
  gap (13 placeholders, 12 bound params, no test coverage). The CI runs this in
  the `lint-typecheck` job.

### Running Test Suites

| Suite                             | Command                   | Notes                                         |
| --------------------------------- | ------------------------- | --------------------------------------------- |
| Core (codec, auth, state machine) | `just test-core`          | Fast, no CF runtime needed                    |
| Worker (runtime + node)           | `just test-worker`        | Runs in workerd pool                          |
| OpAMP compliance                  | `just test-opamp`         | Requires a **live** worker (`just dev` first) |
| E2E collector                     | `just test-e2e-collector` | Requires Docker for real OTel Collectors      |
| UI (Playwright)                   | `just test-ui`            | Browser tests against live stack              |
| All fast tests                    | `just test`               | Core + worker (no live server needed)         |

### AI Guidance Live Check

The manual **AI Guidance Live Check** workflow starts a local seeded
Worker/site stack and runs the Playwright live-provider check against the
MiniMax-backed guidance route.

| Name                                    | Where                 | Purpose                                                                              |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` | GitHub Actions secret | Passed to the local Worker as `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` during checks. |

The workflow sets non-secret provider env vars itself. `scripts/serve-explore.sh`
passes them to `wrangler dev` as Worker vars and bridges `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY`
through a short-lived dotenv file outside the repo, then removes that file once
the Worker is healthy.

| Name                             | Value                       |
| -------------------------------- | --------------------------- |
| `O11YFLEET_AI_GUIDANCE_PROVIDER` | `minimax`                   |
| `O11YFLEET_AI_GUIDANCE_MODEL`    | `MiniMax-M2.7`              |
| `O11YFLEET_AI_GUIDANCE_BASE_URL` | `https://api.minimax.io/v1` |

If `O11YFLEET_AI_GUIDANCE_MINIMAX_API_KEY` is absent, the workflow exits successfully with a notice
instead of silently falling back to fixture guidance.

## API Contract Rules

- Put reusable request, response, and error contracts in `packages/core/src/api`.
- Use Zod schemas as the trust-boundary source of truth, then export inferred
  TypeScript types from those schemas.
- Mutable JSON request schemas should be strict by default so unknown fields are
  rejected instead of silently ignored.
- Worker routes should parse request bodies with `validateJsonBody(request, schema)`
  from `apps/worker/src/shared/validation.ts`; the adapter keeps validation
  failures on the stable `{ error, code, field, detail }` response shape.
- Site and CLI clients should import response/error schemas from
  `@o11yfleet/core/api` when they need runtime validation. Avoid duplicating
  request or response interfaces by hand unless the route does not have a core
  contract yet.

## Auth And Seed Accounts

`POST /auth/seed` creates or updates the configured seed tenant user and admin.
The route is guarded by `O11YFLEET_API_BEARER_SECRET`.

Runtime auth behavior:

| Surface        | Auth path                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------- |
| Browser portal | GitHub social auth through `/auth/github/start`, then HTTP-only `fp_session`                  |
| Tenant API     | Cookie tenant scope, or `Authorization: Bearer <O11YFLEET_API_BEARER_SECRET>` + `X-Tenant-Id` |
| Admin API      | Cookie user with `role = admin`; `O11YFLEET_API_BEARER_SECRET` is rejected                    |
| OpAMP ingress  | Enrollment tokens and signed assignment claims, not browser sessions                          |

Use `GET /auth/github/app-manifest` on the local Worker to create the GitHub App and return the
runtime secret values. User signup/login uses `GITHUB_APP_CLIENT_ID` and
`GITHUB_APP_CLIENT_SECRET`; the app id, webhook secret, and private key are retained for future
GitOps installation flows.

Required local variables are documented in `apps/worker/.dev.vars.example`. Deployment secrets are
documented in [DEPLOY.md](DEPLOY.md).

## Config Rollout Flow

Upload and rollout are intentionally separate:

1. `POST /api/v1/configurations/:id/versions` validates YAML, hashes it, stores
   content in R2, writes a D1 version row, and updates the configuration's current hash.
2. `POST /api/v1/configurations/:id/rollout` reads the current hash/content and
   calls the Config DO `set-desired-config` command.
3. The Config DO stores desired state in DO SQLite and sends remote config to
   connected collectors that accept remote config.
4. Collector ACK/config events go through the Queue consumer into Analytics Engine
   and read-model tables.

## Design Boundaries

- DO SQLite is the source of truth for live collector state.
- D1 is the source of truth for tenants, users, sessions, configs, versions, and tokens.
- R2 stores config YAML by SHA-256 content hash.
- Queues keep the WebSocket hot path free of D1 writes.
- The graph pipeline model is an editor aid; Collector YAML remains the immutable
  rollout artifact.

## Frontend Conventions

The site has Tailwind CSS v4 and shadcn-compatible local primitives, but many
stable pages still use custom CSS under `apps/site/src/styles`.

- Use `@/components/ui/*` for new state-heavy controls: dialogs, popovers, command
  surfaces, AI panels, editor affordances, and tool-call displays.
- Do not rewrite stable pages just to move them to Tailwind.
- Keep generated primitive code reviewed and trimmed.
- Keep new primitives mapped to existing O11yFleet CSS variables so dark/light
  mode and current visual language stay consistent.
