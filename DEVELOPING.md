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
| `packages/db/`         | D1 migrations + Kysely schema types (single type-source)  |
| `packages/test-utils/` | Fake agents and shared test utilities                     |
| `tests/e2e/`           | API/OpAMP end-to-end tests                                |
| `tests/opamp/`         | OpAMP spec compliance tests (54/55 passing)               |
| `tests/e2e-collector/` | Real OTel Collector e2e + version matrix (Docker)         |
| `tests/ui/`            | Playwright browser tests                                  |
| `tests/load*/`         | Load and smoke-test harnesses                             |
| `infra/terraform/`     | Cloudflare infrastructure                                 |

## Dependency Versions

### TypeScript 6.x

The workspace uses **TypeScript 6.0.3+** across all packages. TypeScript 6
introduced stricter module resolution (`NodeNext`) and requires explicit
`"types"` arrays in `tsconfig.json` when using Node.js globals like `process`
or Node-specific modules.

**Known TypeScript 6 compatibility fixes:**

- `apps/cli/tsconfig.json` includes `"types": ["node"]` for Node globals
- `apps/site/tsconfig.test.json` includes `"types": ["node", "react", "react-dom"]` for test environment
- `packages/test-utils/src/fake-agent.ts` uses `Uint8Array<ArrayBuffer>` type for WebSocket.send() compatibility

### Zod 4.x

The workspace uses **Zod 4.1.1+** for runtime validation. Zod 4 introduced
breaking API changes:

**Breaking changes:**

- `z.record(valueSchema)` → `z.record(z.string(), valueSchema)` (explicit key type required)
- Issue type exports moved from `zod` to `zod/v4/core` (`$ZodIssueTooBig`, `$ZodIssueTooSmall`, `$ZodIssueInvalidType`)
- Issue codes renamed: `invalid_enum_value` → `invalid_value`, `invalid_string` → `invalid_format`
- Issue properties renamed: `.type` → `.origin`, `.received` → `.input`
- `z.undefined().optional()` is invalid (produces non-JSON-Schema-compliant output)

**Migration notes:**

- All `z.record()` calls in `packages/core/src/ai/guidance.ts` and `packages/core/src/api/contracts.ts` use the 2-arg form
- `apps/worker/src/shared/validation.ts` imports core issue types from `zod/v4/core` and maps renamed properties
- AI guidance schemas removed `z.undefined().optional()` from action payloads (replaced with nullable string fields)

## First-Time Setup

### 1. Install `just`

`just` is a command runner (like `make` but better). Install it first:

```bash
# macOS/Linux via cargo
cargo install just

# Or via shell installer (Linux/macOS)
curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"

# Verify
just --version
```

### 2. Clone and Install

```bash
git clone https://github.com/your-org/o11yfleet.git
cd o11yfleet
just install
```

### 3. Set Up Environment

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
npx wrangler login   # Opens browser to authenticate with Cloudflare
just doctor          # Verify everything is set up correctly
```

### 4. Start Developing

```bash
just dev-up          # Starts Worker + Site with auto-migration and seeding
```

---

## Local Loop

### Start Everything

```bash
just dev-up
```

This command:

1. Starts the **Worker** at http://localhost:8787 (OpAMP + Management API)
2. Starts the **Site** at http://127.0.0.1:3000 (Portal + Admin UI)
3. Waits for both services to be healthy
4. Applies D1 migrations automatically
5. Seeds local data (tenant, config, enrollment token)

### Dev Secrets

`.dev.vars` ships with placeholder secret values. `just dev-up` runs
`scripts/ensure-dev-secrets.ts` first and replaces any placeholder it
recognises (`dev-local-*`, `*-change-me-*`, `admin-password`,
`demo-password`, `*-dev-only*`) with strong random values. Real values
you set yourself are left alone.

### Partial Start Commands

Use these when you want to start just one service:

| Command    | Starts      | Port |
| ---------- | ----------- | ---- |
| `just dev` | Worker only | 8787 |
| `just ui`  | Site only   | 3000 |

### Reset & Re-seed

```bash
just dev-reset   # Re-runs migrations and seed data (keeps servers running)
```

### Troubleshooting

**`just doctor` fails with "Cloudflare not authenticated"**

```bash
npx wrangler login
```

**`just doctor` fails with "O11YFLEET_API_BEARER_SECRET missing"**

```bash
just ensure-dev-secrets   # Auto-fills placeholder values
```

**Worker crashes on startup with "Missing required secrets"**
These are optional for local dev:

- `CLOUDFLARE_METRICS_ACCOUNT_ID`
- `CLOUDFLARE_METRICS_API_TOKEN`

You can safely ignore these warnings for local development.

---

### All Local Dev Commands

| Command                   | Use when                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| `just dev`                | Start only the Worker                                                          |
| `just ui`                 | Start only the site                                                            |
| `just dev-reset`          | Servers are running and local D1 needs reseeding                               |
| `just smoke`              | Verify API + OpAMP lifecycle (requires: `eval "$(just admin-login)"` first)    |
| `just check`              | Run only checks affected by changed, staged, and untracked files               |
| `just ci`                 | Run the fast local gate before pushing                                         |
| `just ci-pr`              | Reproduce required PR checks, including slow browser/runtime coverage          |
| `just ensure-dev-secrets` | Re-randomize any placeholder values in `apps/worker/.dev.vars` (idempotent)    |
| `just admin-login`        | Log in as the seeded admin and print `FP_ADMIN_COOKIE` for `eval` + curl usage |
| `just playwright-install` | Install Playwright browsers for UI tests (one-time setup)                      |

### Local admin curl

Admin routes (`/api/admin/*`) require an admin session cookie or OIDC
claims — never the bearer secret. To call admin routes from a shell:

```bash
eval "$(just admin-login)"
curl -H "Cookie: $FP_ADMIN_COOKIE" -H "Origin: $FP_URL" \
     "$FP_URL/api/admin/tenants"
```

`just admin-login --cookie` prints just the `fp_session=…` value if
you'd rather wire it into a script directly.

GitHub check mapping lives in [docs/development/dev-loop.md](docs/development/dev-loop.md).

## Testing

### Test Commands

```bash
# Run all fast tests (no live server needed) — ~5 minutes
just test

# Core package only (fastest, ~30 seconds)
just test-core

# Worker unit tests (~1 second)
just test-worker

# Worker runtime tests in workerd (~30 seconds)
just test-runtime

# UI tests with Playwright (requires: just playwright-install first)
# Also requires the API backend to be running (e.g. `just dev` or `just dev-up`)
just test-ui

# Full pre-PR gate
just ci
```

### One-Time Playwright Setup

UI tests require browser binaries. Install once:

```bash
just playwright-install
```

This downloads Chromium and dependencies (~300MB).

For detailed testing strategies and maintenance guidelines, see [TESTING.md](./TESTING.md).

### Running Tests While Developing

| Scenario                | Command                                |
| ----------------------- | -------------------------------------- |
| After every code change | `just test-core` or `just test-worker` |
| Before pushing          | `just ci`                              |
| Full regression         | `just ci-pr` (includes browser tests)  |
| Single test file        | `pnpm vitest run path/to/test.ts`      |

### Live Stack Testing

Some tests require a running dev stack:

```bash
# Start the stack
just dev-up

# In another terminal, run OpAMP compliance tests
just test-opamp

# Run smoke tests (requires admin login first)
eval "$(just admin-login)"
just smoke
```

### Code Quality Checks

```bash
just lint          # Lint all packages
just typecheck     # Type check all packages
just check         # Changed files only (fast)
just sql-audit     # Check SQL bindings after DO changes
just docs-api-check # Check API docs after route changes
```

### Testing Rules

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

### Test Suites

| Suite                             | Command                   | Notes                                                              |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| Core (codec, auth, state machine) | `just test-core`          | Fast, no CF runtime needed                                         |
| Worker (runtime + node)           | `just test-worker`        | Runs in workerd pool                                               |
| OpAMP compliance                  | `just test-opamp`         | Requires a **live** worker (`just dev` first)                      |
| E2E collector                     | `just test-e2e-collector` | Requires Docker for real OTel Collectors                           |
| UI (Playwright)                   | `just test-ui`            | Browser tests (Requires: `just playwright-install` and `just dev`) |
| All fast tests                    | `just test`               | Core + worker (no live server needed)                              |
| Coverage (lines/branches)         | `just coverage`           | Reports per package under `reports/coverage/`                      |

### Worker Runtime Test Triggers

The `scripts/dev-check.ts` script runs `just check` (the pre-commit hook) and
determines which checks to run based on changed files. Worker runtime tests
(`pnpm --filter @o11yfleet/worker test:runtime`) run only when files that
directly affect worker runtime behavior are changed:

**Runtime tests trigger for changes to:**

- `apps/worker/wrangler.jsonc` (worker configuration)
- `apps/worker/src/**` (worker source code)
- `apps/worker/test/**` (worker test files)

**Runtime tests do NOT trigger for changes to:**

- `apps/worker/package.json` (dependency updates without source changes)
- `apps/worker/vitest.config.ts` (test configuration)
- `packages/*/src/**` (shared packages - covered by package-level unit tests)

This scoping prevents slow runtime tests (~30s) from blocking fast dependency
updates while ensuring behavioral changes are still covered. When modifying
shared packages like `@o11yfleet/core` or `@o11yfleet/db`, rely on their
respective unit test suites (`just test-core`, `just test-worker`) and the
full `just ci` gate before pushing.

### Coverage

CodeRabbit enforces docstring and test coverage in PRs — missing docstrings or
untested code will block merge. Use `just coverage` to find gaps.

### Writing Tests

Tests are living documentation: they prove what code _does_, not just what
comments claim. Three questions guide what to test:

1. **Is it a pure function?** → Unit test (`apps/worker/test/<module>.test.ts`,
   add to `vitest.node.config.ts` `include` + coverage `include`).

2. **Does it need DO state (ctx, repo, WebSockets, D1)?** → Runtime test with
   `runInDurableObject()`. No config changes needed.

3. **Does it touch a protocol (OpAMP, OTLP)?** → Test codec round-trips:
   `encode()` → `decode()` preserves data, invalid input fails gracefully.

**Bug fixes**: Write a failing test first. This proves the test catches the
bug, the fix resolves it, and prevents regression.

### Load Testing & Benchmarks

The `tests/load/` directory contains harnesses for performance testing against a
running worker (local or staging).

| Command                                                 | What it does                                                                                                                        | When to use                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `just bench`                                            | Scaling benchmark: opens connections at tiers (500→15K), probes heartbeat RTT at each, then stress-tests SQLite with 30K agent rows | Validating O(1) per-message cost after DO hot-path changes |
| `pnpm --filter @o11yfleet/load-test load -- --agents=N` | Full load test with enrollment, heartbeats, config pushes, and mixed profiles                                                       | Soak testing at target concurrency (2K–30K agents)         |
| `just smoke-staging`                                    | Quick health check against staging                                                                                                  | After deploy, before promoting                             |

All load harnesses use `FakeOpampAgent` from `@o11yfleet/test-utils`. Run with
`scripts/with-local-env.ts` to inject `FP_API_KEY` and `FP_URL` from
`.dev.vars`:

```bash
# Local scaling benchmark
FP_TENANT_ID=seed-dev pnpm tsx scripts/with-local-env.ts -- pnpm --filter @o11yfleet/load-test bench

# Staging 10K load test (6 workers, realistic mix)
FP_URL=https://staging.example.com FP_API_KEY=... FP_TENANT_ID=... \
  pnpm --filter @o11yfleet/load-test load -- --agents=10000 --workers=6
```

**Local workerd ceiling:** ~14–15K connections (no WebSocket Hibernation locally;
each connection costs ~93KB in the workerd process). For 30K+ testing, deploy to
staging where true hibernation reduces per-connection cost to ~200 bytes.

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

The site is migrating to a new stack (see issue #475 — UI rewrite epic):
**Mantine v9 + uPlot + TanStack Table v8 + @xyflow/react + CodeMirror 6**.
During the migration both stacks coexist; pages move one PR at a time.

### New work — use the Mantine stack

- `@mantine/core`, `@mantine/form`, `@mantine/dates`, `@mantine/notifications`,
  `@mantine/modals`, `@mantine/spotlight`, `@mantine/hooks`.
- Theme lives at `apps/site/src/theme/theme.ts`. Brand palette is oklch hue 152°.
- All charts go through `@/charts` — `<TimeSeriesChart>` (uPlot), `<ChartShell>`,
  `<TimeRangePicker>`, `useMetricSeries`. See `apps/site/src/charts/types.ts`
  for the data contract (`Series`, `TimeRange`, `Resolution`, `Observed<T>`).
- New primitives consume `var(--mantine-*)` CSS variables.

### Chart spine playground

Dev-only route at `/playground/spine` exercises the chart density matrix
(0/1/4/100/10k/100k/gappy points), multi-chart cursor sync, brush-to-zoom,
and sparkline mode. Use it to validate any chart-spine change locally.
The route is gated by `import.meta.env.DEV` and is tree-shaken from prod.

### Existing pages — don't rewrite preemptively

- Tailwind CSS v4 + Radix + custom CSS under `apps/site/src/styles` still
  power stable pages. They keep working until their migration PR lands.
- Use `@/components/ui/*` (legacy shadcn-shaped primitives) **only** when
  modifying an existing page that already uses them. New work uses Mantine.
- Custom CSS in `portal-shared.css` etc. will shrink as the cleanup PR lands
  after the four migration PRs (#471, #472, #473, #474).

## Audit log

Every mutating user action (v1 + admin routes, login/logout) is recorded
to the `audit_logs` D1 table. Reads are gated to enterprise-plan tenants
via `GET /api/v1/audit-logs`.

### Wire format

- Producer: handlers call `recordMutation(audit, response, { action, resource_type, resource_id })`
  via route-level wrappers — `withAudit(...)` for v1 routes, `withAdminAudit(...)`
  for admin routes. Coverage is grep-able: every `withAudit(` in
  `routes/v1/*` and every `withAdminAudit(` in `routes/admin/*`
  corresponds to one audited mutation.
- Transport: `env.AUDIT_QUEUE` (`o11yfleet-audit-logs`). Consumer-side
  D1 errors are retried (`max_retries: 5`) before landing in the DLQ.
- DLQ: `o11yfleet-audit-logs-dlq`. The same Worker consumes it and logs
  each event to `console.error` so depth>0 is visible in Workers Logs.
- Failure classification: 2xx/3xx → success; 404/405 → skipped (not a
  real signal); other 4xx and all 5xx → failure. See
  `classifyAuditStatus` in `packages/core/src/audit.ts`.

### Investigating dropped events

If you see `[audit-dlq]` lines in Workers Logs:

```bash
# Inspect the DLQ size and pause/resume delivery for triage
pnpm wrangler queues info o11yfleet-audit-logs-dlq
pnpm wrangler queues pause-delivery o11yfleet-audit-logs-dlq
pnpm wrangler queues resume-delivery o11yfleet-audit-logs-dlq
```

Each DLQ message is a JSON `AuditEvent` already logged via
`console.error`. Wrangler doesn't expose a CLI to re-publish a single
message — to replay, copy the event from logs, then either re-POST
through the producer (a small admin-only script) or use the dashboard's
queue producer UI after verifying D1 is healthy. The audit consumer is
idempotent (`ON CONFLICT(id) DO NOTHING`), so accidental duplicates are
safe.

### Adding audit coverage for a new route

1. For v1 routes, add `withAudit(audit, { action, resource_type, resource_id }, () => handler())`
   at the route call site. For admin routes, use `withAdminAudit(...)`
   instead. That's it — no central table to update.
2. For admin actions targeting a customer tenant, pass the customer
   tenant id as the fourth `withAdminAudit(...)` arg so the customer's
   audit log surfaces the action too.

The migration plan to swap the consumer to WorkOS Audit Logs (mapping
table, open questions, acceptance checklist) lives in
[issue #520](https://github.com/strawgate/o11yfleet/issues/520).

### Mantine usage cheat-sheet

These rules are distilled from three production references: Mantine's own
docs site (`mantinedev/mantine`), the Mantine Analytics Dashboard
(`design-sparx/mantine-analytics-dashboard`), and Refine's `@refinedev/mantine`.
**Canonical reference pages in this repo:** `ConfigurationDetailPage.tsx` and
`AgentDetailPage.tsx` — model new portal work on these.

#### Layout

- **Use layout props, never inline `style={{ flex }}`.** `Stack`, `Group`,
  `Box` accept `gap`, `justify`, `align`, `wrap`, `flex`, `mt`, `mb`, `w`,
  `maw`, `miw`. Reach for `style={{}}` only for one-off CSS variables
  (e.g. `style={{ borderColor: "var(--mantine-color-err-6)" }}`).
- **Page shell is `<PageShell>` → `<PageHeader>` → content.** Both are app
  primitives in `@/components/app`; both wrap Mantine internals.
- **Cards default to `withBorder`, no shadow.** Wired in
  `theme.components.Card.defaultProps` — don't pass `withBorder` per call.

#### Buttons

- **Default size is `sm`** (set in `theme.components.Button.defaultProps`).
  Use `size="xs"` for inline/dense toolbars (pagination, copy buttons),
  `size="md"` for landing-page CTAs.
- **Variants:** primary action → no `variant` (filled, brand color);
  secondary → `variant="default"`; tertiary → `variant="subtle"`.
- **Destructive → `color="red"` on `confirmProps`** of a confirm modal,
  not on the trigger button. Triggers stay neutral; the confirm dialog
  carries the danger styling.
- **Loading state via `loading={mutation.isPending}`**, never via
  conditional disabled + changed label text.

#### Confirmation dialogs — `modals.openConfirmModal`

For any yes/no destructive or consequential action. Never roll your own
`useState`-driven modal for a simple confirm.

```tsx
modals.openConfirmModal({
  title: "Restart all collectors",
  centered: true,
  children: (
    <Stack gap="xs">
      <Text size="sm">
        Send Restart to <strong>N</strong> collectors?
      </Text>
      <Text size="xs" c="dimmed">
        Collectors without <Code>AcceptsRestartCommand</Code> are skipped.
      </Text>
    </Stack>
  ),
  labels: { confirm: "Restart", cancel: "Cancel" },
  confirmProps: { color: "red" },
  onConfirm: async () => {
    /* see notifications below */
  },
});
```

For typed-name confirmations (delete config) or multi-step flows, use a
direct `<Modal>` from `@/components/common/Modal` (which is a Mantine
wrapper) with explicit state.

#### Notifications — loading → success morph

For any mutation triggered by a confirm or button click, use the
loading-toast-then-update pattern. One notification per action, never two:

```tsx
const toastId = notifications.show({
  loading: true,
  title: "Restarting collectors…",
  message: "Sending command to connected agents",
  autoClose: false,
  withCloseButton: false,
});
try {
  const result = await restartFleet.mutateAsync();
  notifications.update({
    id: toastId,
    loading: false,
    color: "brand",
    title: "Restart sent",
    message: `${result.restarted} collector(s) restarted`,
    autoClose: 4000,
    withCloseButton: true,
  });
} catch (err) {
  notifications.update({
    id: toastId,
    loading: false,
    color: "red",
    title: "Restart failed",
    message: err instanceof Error ? err.message : "Unknown error",
    autoClose: 6000,
    withCloseButton: true,
  });
}
```

- **Color convention:** `color="brand"` for success (theme primary, lime
  green), `color="red"` for error, `color="warn"` for warnings,
  `color="info"` for info. Don't use `color="green"` or `color="teal"` —
  those bypass our theme.
- **`autoClose`:** 4s for success, 6s for error, `false` for in-flight
  loading toasts.

#### Tabs

`<Tabs>` for nav-only is fine — keep panels as conditional renders
outside if it minimizes diff. Full `<Tabs.Panel>` wrapping is fine too;
both patterns are valid. Avoid mixing approaches in the same page.

#### Color tokens

- **Theme palettes:** `brand` (lime), `gray`, `ok` (alias of brand),
  `warn`, `err`, `info`. Use these on `<Button color>`, `<Badge color>`,
  notifications.
- **Text shorthand:** `<Text c="dimmed">` for secondary text. Avoid
  `color="dimmed"` (long form for non-text components).
- **Semantic shades** (`color="err.6"`, `color="brand.5"`) only when
  you need a specific tone, e.g. icon highlights.

#### Inline code & text

- **`<Code>` from `@mantine/core`, never raw `<code>` HTML.** The
  raw element doesn't pick up theme background/foreground.
- **Code blocks (multi-line) → `<pre className="code-block">`** for
  now; will migrate to CodeMirror 6 read-only mode in the editor PRs.

#### Forms

- **`@mantine/form`** for any form with > 2 fields or any validation.
  Direct controlled `<TextInput value onChange>` is fine for single-field
  cases (typed-name confirm).
- **`<TextInput>` `data-autofocus` prop** for autofocus inside Modals
  and `modals.openConfirmModal`. The bare `autoFocus` HTML attribute
  silently fails because of Mantine's focus trap.

#### Anti-patterns

- **`window.confirm()`** — never. Always `modals.openConfirmModal`.
- **Two notifications per action** (one for success, one for error
  on a separate `try`/`catch`). Use the `notifications.update()` morph.
- **`useState<boolean>` to drive a `<Modal>` for a simple yes/no
  confirm.** Use `modals.openConfirmModal` instead — drops state and
  modal markup.
- **Mixing `className` with Mantine layout props on the same element.**
  Pick one: either CSS module class or Mantine props. Never both.
- **Raw color names like `color="green"` or `color="teal"`** — bypass
  the theme. Use `brand`, `err`, etc.

#### When in doubt

- Read `ConfigurationDetailPage.tsx` and `AgentDetailPage.tsx` first.
- Check `theme.ts` for what's already defaulted.
- The Mantine docs (mantine.dev) are the authoritative source for
  prop APIs; this cheat-sheet is the team's _opinionated subset_.
