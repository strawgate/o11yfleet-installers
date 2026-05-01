---
name: "Audit: Performance & Hot-Path Defects"
description: "Static source review of worker hot path, DO state, codec, API routes, D1 schema, and the React portal for performance defects"
on:
  workflow_dispatch:
    inputs:
      surfaces:
        description: "Surfaces to audit (comma-separated subset of: worker-hotpath,do-sqlite,codec,api-routes,d1-schema,portal)"
        required: false
        default: "worker-hotpath,do-sqlite,codec,api-routes,d1-schema,portal"
        type: string
      severity_floor:
        description: "Minimum severity to include in the report"
        required: false
        default: "high"
        type: choice
        options:
          - critical
          - high
          - medium
          - low
  # Fuzzy weekly schedule on Tuesday — gh-aw distributes the actual minute to
  # spread load across repos. Catches drift between explicit audits.
  schedule:
    - cron: "weekly on tuesday"
permissions:
  actions: read
  contents: read
  discussions: read
  issues: read
  pull-requests: read
engine:
  id: claude
  model: anthropic/claude-3-5-sonnet-20241022
  env:
    ANTHROPIC_BASE_URL: https://api.minimax.io/anthropic
  concurrency:
    group: "gh-aw-claude-${{ github.workflow }}-perf-audit-${{ github.ref }}"
network:
  allowed: [defaults, github, node]
tools:
  github:
    mode: remote
    toolsets: [default, actions]
    allowed: [create_issue, create_issue_comment, get_workflow_run, list_workflow_jobs, search_issues]
  bash: true
safe-outputs:
  activation-comments: false
  create-issue:
    max: 1
    title-prefix: "[perf-audit] "
    labels: [performance, automated]
    close-older-key: "[perf-audit]"
    close-older-issues: true
    expires: 7d
  add-comment:
    max: 1
    hide-older-comments: true
  noop:
    max: 1
    # gh-aw enables `noop` automatically with `report-as-issue: true` when any
    # safe-output is declared. That would open a tracker every clean run.
    # Override to `false` so a clean run posts no comment and no issue;
    # the workflow run summary in the GitHub Actions UI is enough signal.
    report-as-issue: false
concurrency:
  group: perf-audit-${{ github.ref }}
  cancel-in-progress: true
strict: false
timeout-minutes: 30
steps:
  - name: Setup Node.js
    uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
    with:
      node-version: "24"
  - name: Repo-specific setup
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      npm install -g pnpm@9.15.4
      pnpm install --frozen-lockfile
---

# o11yFleet Performance & Hot-Path Auditor

Audit the worker, Durable Object, codec, API routes, D1 schema, and React
portal for performance defects that survive the existing CI gates (typecheck,
lint, tests). You are looking for the defect classes that don't show up
until 50K agents × 1-hour heartbeats hit a single DO, or until 100 configs
fan out across `Promise.all` API handlers.

This is a **static source review only**. Do not start the dev server, do
not run benchmarks, do not write Playwright tests. Use `Read`, `Glob`,
`Grep`, and `Bash` (read-only) to walk the source. Runtime perf checks live
in the companion `perf-explore-portal.md` workflow.

You are **not** a deterministic test suite. You produce one issue (or PR
comment) per run with prioritized findings, or call `noop` with coverage
notes if the audit is clean.

## Inputs

- `surfaces`: `${{ inputs.surfaces || 'worker-hotpath,do-sqlite,codec,api-routes,d1-schema,portal' }}`
- `severity_floor`: `${{ inputs.severity_floor || 'high' }}`

GitHub Actions only populates `inputs` for `workflow_dispatch`; on
`pull_request` and `schedule` triggers `inputs.*` is empty. The `||`
defaults above ensure a non-empty value at every trigger. **Print the
effective values at the top of your output** (e.g. "Severity floor: high;
surfaces: worker-hotpath,do-sqlite,codec,api-routes,d1-schema,portal") so
a reviewer can confirm.

## Trigger context

- On `pull_request`: post one PR comment summarizing findings (or no
  comment if clean). Limit to defects introduced or worsened on this PR.
- On `schedule` / `workflow_dispatch`: walk all surfaces and open one
  issue with the prioritized findings (or `noop` if clean).

## Reference baseline

A prior audit lives in `docs/performance/audit-2026-04.md`. Read it first.
Treat it as the prior baseline — your job is to:

1. Verify which audit findings are still present (regression gate).
2. Surface any **new** defects of the same classes.
3. Skip findings that have been fixed or that the audit explicitly
   downgraded/withdrew (notably `audit-2026-04.md#47`).

When a finding matches an existing tracker (#272 or its sub-issues
#274–#294), reference it instead of opening a duplicate.

## Defect classes

You are looking for these specific patterns, drawn from the 2026-04 audit.
The file:line references in each bullet are exemplars from the prior
baseline — generalize the pattern, do not hard-code the line numbers.

### A. Worker hot path (per-WS-message, per-heartbeat)

Files: `apps/worker/src/durable-objects/*.ts`,
`packages/core/src/state-machine/*.ts`,
`packages/core/src/codec/*.ts`,
`packages/core/src/hex.ts`,
`packages/core/src/auth/claims.ts`.

Look for:

- **Allocations inside hot-path functions**:
  `new TextEncoder()` / `new TextDecoder()` per call (hoist to module
  scope). Existing example: `processor.ts` `sha256Hex` allocates a fresh
  encoder per heartbeat.
- **`Array.from(typedArray)` / `Array.from(...).map(...).join("")`** on
  the encode/decode path. `framing.ts` does this for `Uint8Array` fields,
  inflating the wire 5–10×; `hex.ts` does it for hex conversions. Flag
  unless the input is bounded and the result is base64url-safe.
- **Hand-rolled crypto** (`sha256Hex`, custom HMAC) where
  `crypto.subtle.digest` / `crypto.subtle.sign` would work. Workers ship
  BoringSSL natively.
- **`crypto.subtle.importKey` per call** in any signing/verifying helper.
  Cache by secret per isolate (`Map<string, Promise<CryptoKey>>`).
- **Two reads of the same DO-SQLite row in one message handler.** Existing
  example: `webSocketMessage` calls `getDesiredConfig()` directly **and**
  via `getConfigBytes()` (which calls it again).
- **Re-encoding identical data per loop iteration.** A rollout broadcast
  that calls `encodeServerToAgent(...)` per socket where only
  `instance_uid` differs across sockets — the YAML body is identical.
- **`JSON.stringify(...)` for change detection on every heartbeat** when
  the underlying object is large. Compare a hash, or compare structurally
  before stringifying.
- **`Object.values(obj)[0]`** when only the first value is needed (one
  unnecessary array allocation).

### B. DO SQLite event/state mechanics

Files: `apps/worker/src/durable-objects/agent-state-repo.ts`,
`apps/worker/src/durable-objects/config-do.ts`.

Look for:

- **`SELECT *` in DO-SQLite hot path** when only a few columns are read.
  `loadAgentState` is the canonical example.
- **`SELECT COUNT(*)` per write** triggered by trim/cap helpers. Cache
  the count or amortize.
- **`DELETE … WHERE id NOT IN (SELECT id … ORDER BY id DESC LIMIT ?)`**
  pattern. Replace with `WHERE id <= (SELECT MAX(id) - ?)` or a stored
  cutoff.
- **DO-SQLite `DELETE … WHERE col < ?` without an index on `col`** —
  hot in the alarm tick.
- **Independent aggregate queries that could merge into one CTE.**
  Example: `getStats` + `getCohortBreakdown` runs 4 queries that produce
  one stats response.

### C. Codec compactness

Files: `packages/core/src/codec/*.ts`.

Look for:

- **JSON-replacer encoding `Uint8Array` as `{ __type: "bytes", data:
  Array.from(value) }`**. Each byte becomes a decimal JSON number; switch
  to base64url. Verify the reviver matches.
- **Per-value reviver** in `JSON.parse(text, reviver)` running for keys
  it doesn't transform. Walk the parsed object once after `JSON.parse`.
- **Extra `Uint8Array.buffer.slice(...)`** after `set(...)` in protobuf
  framing — second copy of the same payload.

### D. API route round-trips

Files: `apps/worker/src/routes/v1/*.ts`,
`apps/worker/src/routes/admin/*.ts`,
`apps/worker/src/routes/auth.ts`.

Look for:

- **SELECT-then-UPDATE-then-SELECT (3 round-trips) for one PUT.** Use
  D1 `RETURNING *`.
- **`getOwnedConfig` / equivalent ownership check via `SELECT *` before
  every write**, when `WHERE id=? AND tenant_id=?` on the UPDATE/DELETE
  + checking `result.meta.changes` would suffice.
- **Sequential `await` in a `for` loop over R2/D1 work** that has no
  inter-iteration dependency — wrap in `Promise.all`.
- **N+1 DO/D1 fan-out** in any "overview" handler. Existing example:
  `handleGetOverview` calls `stub.fetch("/stats")` per configuration with
  no caching.
- **Materialized derived-table subqueries in a list query** that D1's
  optimizer cannot flatten (e.g. `LEFT JOIN (SELECT … GROUP BY)` over a
  large table) when correlated scalar subqueries or counter columns
  would do.
- **`LOWER(col) LIKE LOWER(?)`** that defeats indexes. Use
  `col COLLATE NOCASE LIKE ?`.
- **`%term%` LIKE patterns on indexed columns** that fail to use the
  index. Suggest prefix match or FTS5.
- **Unconditional PBKDF2 / bcrypt hashing in seed/idempotent paths**
  even when the input matches the stored hash.
- **Allocation of `new TextEncoder()` per request** in helpers like
  `timingSafeEqual`.

### E. D1 schema gaps

Files: `packages/db/migrations/*.sql`.

Look for:

- **`ORDER BY <col> DESC` in any list endpoint without an index that
  matches** the leading sort column (composite indexes welcome).
- **Filtered scans that need partial indexes** — e.g.
  `WHERE revoked_at IS NULL` over a large table.
- **Redundant explicit indexes that duplicate UNIQUE-constraint indexes**
  (SQLite auto-creates an index for UNIQUE). Existing example:
  `enrollment_tokens.token_hash` has both.
- **Missing `(tenant_id, created_at DESC)`-style composite indexes** for
  per-tenant list endpoints.

When a column has bounded cardinality (≤ ~10 values) AND the table is
small (≤ ~10K rows), do **not** flag a missing index — the audit
explicitly downgraded `tenants.plan` for this reason.

### F. Frontend perf

Files: `apps/site/src/api/hooks/*.ts`,
`apps/site/src/pages/portal/*.tsx`,
`apps/site/src/pages/admin/*.tsx`,
`apps/site/src/components/**/*.tsx`.

Look for:

- **`refetchInterval` on a list hook that cascades** to per-item child
  hooks. Cap at 30s, prefer `refetchOnWindowFocus`, or use server push.
- **Sequential `.filter()` calls on the same array** (one reduce will do).
- **Object literals as `useMemo` dependencies** when the literal is built
  unconditionally each render — the memo never hits. Existing example:
  `pageContext` rebuilt every render then used as a dep in
  `browserContext`'s `useMemo`.
- **`<Section>` per parent-list-item with its own React-Query hooks** in
  unvirtualized `cfgList.map(...)` shapes — every refetch re-mounts all
  sections.
- **`JSON.stringify` in render paths** for change detection.

## Severity rubric

- **Critical**: every WS message or every API request impact, or behavior
  bug (e.g. duplicate writes, broken dedup).
- **High**: visible at fleet scale (≥ 1K agents) or every page render.
- **Medium**: small constant-factor wins.
- **Low**: micro-optimizations or stylistic.

Apply `severity_floor`. On PR runs, weight toward defects introduced or
worsened by the diff.

## What to report

For each finding (`severity ≥ severity_floor`), record:

- **Title**: short imperative ("Cache DO-SQLite desired-config bytes per
  hash").
- **Severity** + **Class** (A–F).
- **File:line** (exact line range).
- **Symptom** (what the code does today).
- **Impact at scale** (per-message / per-request / per-render frequency
  × cost estimate; tie to the audit's hot-path budget when applicable).
- **Fix** (≤ 5 lines of TS or SQL, or a one-paragraph plan).
- **Existing tracker reference** if the defect maps to #272 or any of
  #274–#294, or to epics #218 / #217 / #232 / #233 / #60.

Do **not** include findings that:

- Were explicitly withdrawn in `docs/performance/audit-2026-04.md`
  (notably #47).
- Are already covered by an open issue you found via `search_issues`
  unless the diff has materially changed them. Reference, don't dupe.
- Apply only outside the listed surfaces.

## Output

Emit exactly one final safe output, then stop:

- **PR runs**: `add-comment` with up to 10 findings, ranked
  Critical → High → Medium. Group by class. Title the comment
  `## Performance audit findings`. If clean, call `noop` (no comment is
  posted).
- **Schedule / dispatch runs**: `create_issue` titled `[perf-audit]
  weekly hot-path scan` (the title-prefix above adds the bracket;
  use the rest of the title to summarize the top finding) with the same
  ranked content. If clean, call `noop`.

If browser/runtime tools are unexpectedly invoked, report `missing_tool`
and stop — this workflow is static-only by design.
