# FleetPlane v1: Agent-Executable Development Plan

## Where Models Agree

| Finding                                                                                                                                                                           | Claude Opus 4.7 | Gemini 3.1 Pro Thinking | GPT-5.5 | Evidence                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------- | ------- | --------------------------------------------------------------------------------------------- |
| Structure as dependency DAG with explicit inputs/outputs per workstream                                                                                                           | ✓               | ✓                       | ✓       | Enables parallel agent execution without coordination overhead                                |
| Phase 0 is sequential bootstrap; everything else branches from it                                                                                                                 | ✓               | ✓                       | ✓       | Repo skeleton + tooling must exist before any agent can work                                  |
| Pure OpAMP core (codec + state machine) has zero CF imports                                                                                                                       | ✓               | ✓                       | ✓       | Testable in plain Vitest; swappable to WASM later                                             |
| Fake agent is a first-class deliverable, not an afterthought                                                                                                                      | ✓               | ✓                       | ✓       | Required input for every integration and E2E test                                             |
| Config DO, queue consumer, R2 storage, auth tokens are fully independent workstreams                                                                                              | ✓               | ✓                       | ✓       | No shared mutable state between them until integration phase                                  |
| Integration phase requires synchronization point before E2E                                                                                                                       | ✓               | ✓                       | ✓       | Components must connect before system-level tests make sense                                  |
| 10 specific E2E scenarios as hard acceptance criteria                                                                                                                             | ✓               | ✓                       | ✓       | Enrollment, reconnect, config push, seq gap, disconnect, retry, dedup, auth, limits, spoofing |
| `@cloudflare/vitest-pool-workers` for offline integration tests [developers.cloudflare](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/) | ✓               | ✓                       | ✓       | Runs inside real workerd runtime with D1/R2/DO/Queue bindings                                 |
| Performance experiment is a parallel track, never blocking v1                                                                                                                     | ✓               | ✓                       | ✓       | TS baseline vs Rust-WASM; decision rule: ≥2x faster or don't switch                           |

## Where Models Disagree

| Topic                            | Claude Opus 4.7                  | Gemini 3.1 Pro Thinking       | GPT-5.5                                                        | Why They Differ                                                                      |
| -------------------------------- | -------------------------------- | ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Granularity**                  | 5 phases, ~17 tracks total       | 4 phases, ~10 tasks           | 13 phases, ~35 workstreams                                     | GPT-5.5 decomposes to individual-agent-assignable units; others batch more           |
| **When UI happens**              | Phase 4 (after E2E)              | Explicitly excluded from plan | Phase 11 (late, parallel)                                      | Gemini 3.1 Pro Thinking says UI is not an engineering deliverable; others include it |
| **Workstream assignment format** | Implicit via track descriptions  | Implicit                      | Explicit template with inputs/outputs/do-not-modify/acceptance | GPT-5.5 optimizes for agent handoff                                                  |
| **API routes as separate phase** | Bundled into Phase 3 integration | Bundled into integration      | Dedicated Phase 8 with 3 sub-workstreams                       | GPT-5.5 treats API as its own concern; others fold it in                             |
| **Definition of done**           | Exit criteria per phase          | Acceptance criteria per phase | Explicit "Definition of Done for v1" section                   | GPT-5.5 adds a project-level completion gate                                         |

## Unique Discoveries

| Model           | Unique Finding                                                                                             | Why It Matters                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GPT-5.5         | Agent assignment template format: `{workstream, inputs, do-not-modify, tasks, tests-required, acceptance}` | Directly executable by coding agents without ambiguity                             |
| GPT-5.5         | Header spoofing E2E scenario (#10): external request with fake `x-fp-tenant-id` headers must be stripped   | Security hole that's easy to miss; catches trust-boundary bugs                     |
| GPT-5.5         | Separate workstream for request context encoding between ingress Worker and DO                             | Prevents a class of bugs where external headers leak into trusted internal routing |
| Claude Opus 4.7 | Explicit critical path identification: Phase 0 → 1C (core) → 2B (Config DO) → 3 sync → 4A (E2E)            | Tells you which workstreams to staff first if agents are limited                   |

---

## The Definitive Plan

What follows merges all three models into a single plan optimized for parallel agent execution. I've adopted GPT-5.5's granularity (agents need small, clear units), Claude Opus 4.7's critical-path awareness, and Gemini 3.1 Pro Thinking's "contracts first" principle.

---

# Phase 0 — Bootstrap

**Depends on:** Nothing.
**Agents:** 1. Sequential. Everything else depends on this.

## Deliverables

- Monorepo: pnpm workspaces, Turborepo, TypeScript strict, ESLint, Prettier
- Package skeletons: `packages/core`, `packages/test-utils`, `apps/worker`, `apps/web`, `infra/terraform`, `experiments/`
- `wrangler.toml` with binding stubs (D1, R2, Queue, DO, Analytics Engine)
- `@cloudflare/vitest-pool-workers` configured [developers.cloudflare](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)
- GitHub Actions CI: `lint → typecheck → test → terraform validate`
- `docs/architecture.md` documenting: Config-as-DO partitioning, signed claims, R2 content-addressing, queue read model, offline testing

### Exit Criteria

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test  # passes
wrangler dev  # starts, GET /healthz → 200
```

---

# Phase 1 — Foundations (5-Way Parallel)

**Depends on:** Phase 0.
**Agents:** 5, fully independent. No shared state.

## 1A — Terraform Infrastructure

**Owns:** `infra/terraform/`

Provision per environment (dev/staging/prod):

- `cloudflare_d1_database`
- `cloudflare_r2_bucket`
- `cloudflare_queue`
- Worker routes, Pages project

**Exit:** `terraform apply -var-file=envs/dev.tfvars` succeeds. Resource IDs exported as outputs.

## 1B — D1 Schema & Migrations

**Owns:** `packages/db/`

```sql
-- tenants, configurations, config_versions, enrollment_tokens, agent_summaries
-- See full DDL in prior conversation
```

Seed script for local dev. `pnpm db:migrate:local` and `pnpm db:seed:local`.

**Exit:** Migrations apply locally. Seed populates test tenant/config/token. Test queries succeed. [developers.cloudflare](https://developers.cloudflare.com/d1/best-practices/local-development/)

## 1C — OpAMP Protocol Core ⚡ CRITICAL PATH

**Owns:** `packages/core/src/codec/`, `packages/core/src/state-machine/`

Zero Cloudflare imports. Pure TypeScript.

- Official `.proto` → generated TS bindings
- `decodeAgentToServerFrame(buf: ArrayBuffer): AgentToServer`
- `encodeServerToAgentFrame(msg: ServerToAgent): ArrayBuffer`
- `processFrame(state, msg) → { newState, response, events, shouldPersist }`
- Handles: hello, heartbeat, config offer, config ack, sequence gap, health change
- Golden test fixtures (binary .bin + expected .json)
- ≥20 unit tests

**Exit:** All fixtures round-trip. Tests run in <2s with plain Vitest. No CF runtime needed.

## 1D — Signed Assignment Claims

**Owns:** `packages/core/src/auth/`

```typescript
interface AssignmentClaim {
  v: 1; tenant_id: string; config_id: string;
  instance_uid: string; generation: number; iat: number; exp: number;
}
signClaim(claim, secret): Promise<string>
verifyClaim(token, secret): Promise<AssignmentClaim>
```

HMAC-SHA256 via Web Crypto. Base64url JSON `.` signature format.

Also: `generateEnrollmentToken()`, `hashEnrollmentToken()`, `verifyEnrollmentToken()`. Token format: `fp_enroll_{base64url_random_32_bytes}`. Store only SHA-256 hash.

**Exit:** Valid/expired/tampered/wrong-secret tests pass. Raw tokens never persisted.

## 1E — Fake OpAMP Agent

**Owns:** `packages/test-utils/`

```typescript
class FakeOpampAgent {
  constructor(opts: { endpoint; enrollmentToken?; assignmentClaim?; instanceUid? });
  connect(): Promise<void>;
  sendHello(): Promise<void>;
  sendHeartbeat(): Promise<void>;
  sendHealth(status): Promise<void>;
  waitForRemoteConfig(): Promise<RemoteConfig>;
  applyConfig(hash): Promise<void>;
  close(): Promise<void>;
}
```

Uses `packages/core` for framing. Manages sequence numbers internally.

**Exit:** Can generate valid OpAMP frames. Unit tests verify frames decode via core codec.

---

# Phase 2 — Components (4-Way Parallel)

**Depends on:** Phase 1 (all tracks).
**Agents:** 4, fully independent.

## 2A — R2 Content-Addressed Config Storage

**Owns:** `apps/worker/src/config-store.ts`

**Inputs:** D1 schema (1B)

- `uploadConfigVersion(env, tenantId, configId, yaml) → { hash, r2Key }`
- SHA-256 → R2 key `configs/sha256/{hash}.yaml` [developers.cloudflare](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- D1 upsert `configurations.current_config_hash` + insert `config_versions`
- Dedup: same YAML = same key, one R2 object
- Vitest Workers pool tests with local R2 + D1

**Exit:** Upload, dedup, and read tests pass locally.

## 2B — Config Durable Object ⚡ CRITICAL PATH

**Owns:** `apps/worker/src/durable-objects/config-do.ts`

**Inputs:** Core codec + state machine (1C), event types (shared), claims (1D)

The central stateful actor:

1. **Constructor** — minimal. No storage reads. [developers.cloudflare](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
2. **`fetch`** — route WebSocket upgrade vs HTTP command.
3. **WebSocket accept** — `ctx.acceptWebSocket(server)` + `serializeAttachment({tenant_id, config_id, instance_uid, connected_at})`. [developers.cloudflare](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
4. **`webSocketMessage`** — deserialize attachment → decode frame (1C) → load agent state from DO storage → call `processFrame` → persist if changed → emit queue event → send response.
5. **`webSocketClose`** — mark disconnected, emit event.
6. **`webSocketError`** — clean close with error code.
7. **HTTP commands** — `POST /command/set-desired-config`, `GET /stats`, `GET /agents`.
8. **DO-internal SQLite** — `agents` table with indexes.
9. **Strictly reactive** — no alarms, no timers, no intervals.

**Exit:** Vitest Workers pool tests: connection, message round-trip, disconnect, attachment restore after wake, set-desired-config command. [blog.cloudflare](https://blog.cloudflare.com/workers-vitest-integration/)

## 2C — Queue Event Consumer

**Owns:** `apps/worker/src/event-consumer.ts`

**Inputs:** D1 schema (1B), event types (shared)

- `queue(batch, env)` handler
- Batch D1 upserts to `agent_summaries` with `ON CONFLICT` [developers.cloudflare](https://developers.cloudflare.com/queues/configuration/local-development/)
- Analytics Engine `writeDataPoint` per event [developers.cloudflare](https://developers.cloudflare.com/analytics/analytics-engine/)
- Idempotent: duplicate events harmless

**Exit:** Local queue test: produce event → consumer writes D1 → duplicate safe → batch failure retries.

## 2D — API Route Handlers

**Owns:** `apps/worker/src/routes/api/`

**Inputs:** D1 schema (1B), config store (can mock), enrollment tokens (1D)

CRUD routes:

```text
POST   /api/tenants
GET    /api/tenants/:id/configurations
POST   /api/configurations
GET    /api/configurations/:id
POST   /api/configurations/:id/versions        → calls 2A
POST   /api/configurations/:id/enrollment-token → calls 1D
GET    /api/configurations/:id/agents           → reads D1
GET    /api/configurations/:id/stats            → calls DO
POST   /api/configurations/:id/rollout          → calls DO
```

**Exit:** Each endpoint has handler tests against local D1/R2 bindings. Nonexistent resource returns 404.

---

# Phase 3 — Integration (2 Tracks → Sync Point)

**Depends on:** Phase 2 (all tracks).
**Agents:** 2 parallel, then 1 for synchronization.

## 3A — Ingress Router

**Owns:** `apps/worker/src/index.ts` routing logic

Route `/v1/opamp` to Config DO:

1. **Hot path:** Extract assignment claim from `Authorization: Bearer`. Verify locally (no I/O). Build DO name `${tenant_id}:${config_id}`. Forward request.
2. **Cold path:** No claim → extract enrollment token → hash → D1 lookup → validate → route to DO.
3. **Security:** Strip any external `x-fp-*` headers before forwarding to DO. Pass validated context via internal headers.

Route `/api/*` to API handlers (2D).

**Exit:** Valid claim → correct DO. Expired claim → 401. Enrollment token → DO + claim returned. Spoofed headers stripped.

## 3B — Config DO Enrollment Integration

**Owns:** Integration between ingress (3A) and Config DO (2B)

When agent connects with enrollment token (no claim):

- Config DO creates agent record
- Config DO generates signed assignment claim (1D)
- Claim returned in first `ServerToAgent` response
- Agent stores claim for future reconnects

When `set-desired-config` called:

- Config DO updates desired hash
- Iterates `ctx.getWebSockets()` → sends `ServerToAgent` with new `RemoteConfig` reference to all connected agents

**Exit:** Enrollment → claim issuance → reconnect-with-claim → config push all work.

## 3-SYNC — Full Lifecycle E2E ⚡ CRITICAL PATH

**Depends on:** 3A + 3B complete.
**Agents:** 1.

The canonical system test using the fake agent:

```text
Create tenant → create config → upload YAML v1 → create enrollment token →
fake agent connects with token → receives assignment claim →
receives remote config offer → applies config → sends ack →
queue processes event → D1 agent_summaries shows "applied" →
upload YAML v2 → connected agent receives new config →
agent applies v2 → disconnect → queue processes disconnect →
D1 shows "disconnected"
```

**Exit:** This test passes entirely offline. If it does, the system works.

---

# Phase 4 — E2E Suite + Hardening (6-Way Parallel)

**Depends on:** Phase 3 sync point passed.
**Agents:** 6, fully independent.

## 4A — 10 Required E2E Scenarios

Each scenario is independently assignable:

| #   | Scenario                       | Key Assertion                                 |
| --- | ------------------------------ | --------------------------------------------- |
| 1   | New enrollment                 | Token → claim → connected in D1               |
| 2   | Reconnect with claim           | No D1 hit on hot path                         |
| 3   | Config update push             | Connected agent receives v2                   |
| 4   | Sequence gap                   | Server sends `ReportFullState` flag           |
| 5   | Disconnect                     | `webSocketClose` → offline in D1              |
| 6   | Hibernation restore            | Socket attachments survive DO eviction        |
| 7   | Queue retry                    | Consumer fails once → retries → D1 correct    |
| 8   | R2 dedup                       | Same YAML → one R2 object                     |
| 9   | Free-tier limits               | Agent beyond max rejected cleanly             |
| 10  | Auth failure + header spoofing | Invalid claim → 401; spoofed headers stripped |

**Exit:** All 10 pass offline in CI.

## 4B — Rate Limits & Quotas

Enforce in Config DO + ingress:

- Max messages/minute/agent
- Max config size (256 KB)
- Max agents per config (configurable, default 50k)
- Max configs per tenant (free = 5)
- Clean WebSocket close codes on breach
- Analytics Engine usage counters per tenant [developers.cloudflare](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)

**Exit:** Tests verify limits enforced and errors explicit.

## 4C — Error Handling & Observability

- Typed errors: `AppError`, `AuthError`, `ProtocolError`, `RateLimitError`, `StorageError`
- Map to HTTP status / WebSocket close code / queue event / analytics event
- No raw stack traces returned
- Request ID on every error log
- Analytics Engine datapoints: latency, bytes, result code per OpAMP frame

**Exit:** Error tests cover each class. Analytics writes don't break main flow.

## 4D — Cost Guardrails (Code Review)

Verify and test:

- [ ] No D1 write on no-op heartbeat
- [ ] No queue event on no-op heartbeat
- [ ] No timers/alarms in Config DO
- [ ] No KV read on hot path
- [ ] R2 serves config payloads, not DO
- [ ] DO stores current state only
- [ ] `heartbeat_interval_seconds` set to 900+ for stable agents

**Exit:** Tests assert no-op heartbeat causes zero storage writes and zero queue events.

## 4E — CI/CD Pipeline

On PR: `lint → typecheck → test → test:e2e → terraform validate`

On main: `terraform apply staging → d1 migrate staging → wrangler deploy staging → smoke test`

On tag: manual approval → same for prod.

Smoke test: create temp tenant → run fake agent → verify lifecycle → cleanup.

**Exit:** Staging deploy fully automated. Smoke test passes.

## 4F — Minimal UI (Optional, Non-Blocking)

Cloudflare Pages app:

- Config list + detail
- Agent table (from D1 read model)
- YAML upload form
- Enrollment token display + copy
- Points at local Worker in dev

**Exit:** Human can complete demo in browser. Not required for v1 definition of done.

---

# Phase 5 — Performance Experiment (Fully Parallel, Non-Blocking)

**Depends on:** Phase 1C (core fixtures exist).
**Agents:** 3, independent.

## 5A — Benchmark Harness

```text
10k frame decodes, 10k encodes, 10k state transitions,
1k agents × 100 messages, config push to 1k connections
```

Metrics: p50/p95/p99 latency, CPU time, memory. JSON output.

## 5B — TypeScript Baseline

Run harness against current core. Establish baseline.

## 5C — Rust-WASM Core

Reimplement only codec + state machine in Rust. Compile to WASM. Wire via `wasm-bindgen`. Run same harness. Same fixtures must pass.

**Decision rule:** Ship WASM only if ≥2x faster on decode+process+encode OR ≥30% cheaper at realistic DO volume. Otherwise ship TypeScript.

---

# Dependency Graph

```text
Phase 0 (1 agent, sequential)
  │
  ├── Phase 1A  Terraform          ──────────────────────────┐
  ├── Phase 1B  D1 Schema          ──────────────────────────┤
  ├── Phase 1C  OpAMP Core ⚡      ──────────────────────────┤
  ├── Phase 1D  Auth/Claims        ──────────────────────────┤
  └── Phase 1E  Fake Agent         ──────────────────────────┤
                                                              │
  ┌───────────────────────────────────────────────────────────┘
  │  (all of Phase 1 complete)
  │
  ├── Phase 2A  R2 Config Store    ──────────────────────────┐
  ├── Phase 2B  Config DO ⚡       ──────────────────────────┤
  ├── Phase 2C  Queue Consumer     ──────────────────────────┤
  └── Phase 2D  API Routes         ──────────────────────────┤
                                                              │
  ┌───────────────────────────────────────────────────────────┘
  │  (all of Phase 2 complete)
  │
  ├── Phase 3A  Ingress Router     ───┐
  └── Phase 3B  DO Enrollment      ───┤
                                      │
                                      ▼
                             Phase 3-SYNC  Full E2E ⚡
                                      │
  ┌───────────────────────────────────┘
  │
  ├── Phase 4A  10 E2E Scenarios
  ├── Phase 4B  Rate Limits
  ├── Phase 4C  Error Handling
  ├── Phase 4D  Cost Guardrails
  ├── Phase 4E  CI/CD Pipeline
  └── Phase 4F  Minimal UI (optional)


Phase 1C ──► Phase 5A/5B/5C  Performance Experiments (non-blocking)
```

---

# Parallel Execution Summary

| Phase | Max Concurrent Agents | Critical Path?                 |
| ----- | --------------------- | ------------------------------ |
| 0     | 1                     | Yes — everything blocks on it  |
| 1     | **5**                 | 1C is on critical path         |
| 2     | **4**                 | 2B is on critical path         |
| 3     | **2 → 1 sync**        | 3-SYNC is the gate             |
| 4     | **6**                 | 4A + 4E are most important     |
| 5     | **3**                 | No — runs in parallel with 2-4 |

**Critical path:** `0 → 1C → 2B → 3-SYNC → 4A`

If agents are limited, staff the critical path first. Everything else can catch up.

---

# Agent Assignment Format

Every workstream should be handed to an agent in this format:

```text
┌─────────────────────────────────────────────────┐
│ Workstream: Phase 2B — Config Durable Object    │
│                                                 │
│ Inputs:                                         │
│   packages/core/src/codec/*                     │
│   packages/core/src/state-machine/*             │
│   packages/core/src/auth/*                      │
│   packages/core/src/events.ts                   │
│                                                 │
│ Owns:                                           │
│   apps/worker/src/durable-objects/config-do.ts  │
│   apps/worker/test/config-do.test.ts            │
│                                                 │
│ Do not modify:                                  │
│   infra/terraform/*                             │
│   packages/db/*                                 │
│   apps/web/*                                    │
│                                                 │
│ Tasks:                                          │
│   1. Implement ConfigDurableObject class        │
│   2. WebSocket accept with hibernation API      │
│   3. webSocketMessage: decode → process → reply │
│   4. webSocketClose: mark offline, emit event   │
│   5. HTTP commands: set-desired-config, stats   │
│   6. DO-internal SQLite: agents table           │
│                                                 │
│ Tests required:                                 │
│   - WS connect returns 101                      │
│   - Hello handled, config offered               │
│   - No-op heartbeat: zero storage writes        │
│   - Config mismatch sends RemoteConfig          │
│   - Disconnect marks offline                    │
│   - set-desired-config updates desired hash     │
│                                                 │
│ Exit criteria:                                  │
│   pnpm test --filter config-do passes           │
│   No timers, no alarms, no intervals in code    │
└─────────────────────────────────────────────────┘
```

---

# Definition of Done — v1 Development Complete

- [ ] Phase 3-SYNC E2E passes: enrollment → claim → WS → config delivery → ack → queue → D1
- [ ] All 10 Phase 4A E2E scenarios pass offline in CI
- [ ] Terraform provisions dev/staging/prod without manual steps
- [ ] `wrangler deploy` succeeds from CI
- [ ] Staging smoke test passes automatically
- [ ] No hot-path KV/D1 lookup (signed claims only)
- [ ] No D1 write on no-op heartbeat
- [ ] Config DO uses WebSocket hibernation exclusively
- [ ] Config payloads content-addressed in R2
- [ ] Queue consumer is idempotent
- [ ] Free-tier quotas enforced in Config DO
- [ ] Performance baseline documented (TS; WASM comparison if complete)
- [ ] Fake agent robust enough for all protocol scenarios

---

## Quality & Architecture Improvements

### What We Fixed

- Removed infrastructure-swallowing `try/catch` in `authenticate()` and admin overview — the app trusts its schema now
- `/auth/seed` gated behind `Bearer API_SECRET` (was open)
- CORS scoped to explicit origins (was `*`)
- Removed dead `middleware.ts` with insecure stub auth
- Error boundary on main `fetch()` handler — returns 500 JSON not uncaught exception
- All 111 worker tests passing, all TS compilation errors fixed
- Flash-of-hardcoded-data fixed, fake-success buttons converted to "not implemented" warnings

---

## Codebase Audit — Systemic Issues

### 1. Infrastructure-Swallowing Error Handling

**Pattern:** `catch(() => ({ count: 0 }))` or `catch { return null }` around D1/DO queries. Converts schema drift, missing tables, or broken joins into "empty data" instead of surfacing deployment bugs.

**Found in:** `event-consumer.ts` (analytics writes), `config-do.ts` (queue emission, socket fanout), `v1/index.ts` (per-config stats)

**Fix:** Application code should never defensively handle missing infrastructure. If a table doesn't exist, the deploy is broken — fail loud. The remaining catch blocks in `config-do.ts` and `event-consumer.ts` need review: some are legitimate (WS send to a closed socket) but should at minimum log/metric, not silently swallow.

### 2. Triplicated Route Logic

**Pattern:** `api/index.ts`, `admin/index.ts`, and `v1/index.ts` each define their own `jsonError()`, `parseJsonBody()`, custom error class, and route dispatch table. Tenant/config/token CRUD is largely copy-pasted across all three.

**Impact:** Every bug fix or validation improvement must be applied 3 times. Inconsistencies creep in (different field names, different validation depth).

**Fix:** Move to Hono with shared middleware and a single set of handlers parameterized by auth context.

### 3. Untyped D1 Boundary

**Pattern:** `row["field"] as Type` casts throughout `agent-state-repo.ts`, `v1/index.ts`, `api/index.ts`. The D1/SQLite boundary is effectively untyped despite strict TS being on.

**Fix:** Introduce Drizzle ORM for typed D1 queries. Generates types from schema, eliminates casts, catches column name mismatches at compile time.

### 4. Frontend Global State Soup

**Pattern:** `portal-api.js`, `shared.js`, `portal-shell-render.js`, `portal-shell.js`, `portal-pipeline.js` all attach mutable state to `window`. No module boundary. Pages use `innerHTML` for rendering, causing listener leaks on polling cycles.

**Impact:** Every page has subtle bugs: listeners accumulate on each poll, theme toggling is implemented 3 different ways, `esc()` XSS helper is copy-pasted into 7 files.

**Fix:** React with proper component lifecycle, module boundaries, and a real state management story.

### 5. Security: `?api=` URL Override

**Pattern:** `portal-api.js` trusts `?api=` from the URL and persists it to `localStorage`. Any shared link can repoint the portal to an arbitrary API origin, including the login flow.

**Fix:** Remove entirely. API base URL should be derived from the deployment environment, not user-controllable input.

### 6. Missing Input Validation

**Pattern:** Route handlers accept partial/malformed input without validation. `expires_in_hours: 0` bypasses intent. Login accepts any non-empty email/password with no format/length check. Client-side destructive actions (rollout, delete) trust URL params without guards.

**Fix:** Zod schemas at every API boundary. Shared between client and server.

### 7. Client/Server Contract Mismatches

**Concrete bugs found:**

- `getting-started.html` expects `raw_token` but worker returns `token`
- `agents.html` expects `connected`, `health`, `hostname` but DO returns `status`, `healthy`, `last_seen_at`
- `agent-detail.html` ignores `uid`/`config` params, reads synthetic `?a=` index

**Fix:** Shared TypeScript types between worker and React app via `packages/core`. Contract tests.

### 8. No Frontend Lint/Test/Typecheck

**Pattern:** `apps/site/package.json` has no lint, typecheck, or test script. `apps/web/package.json` has lint and typecheck as `echo 'no-op'`. The highest-smell surface in the codebase is outside all automation.

**Fix:** React + Vite + TypeScript puts the entire frontend under the same lint/typecheck/test pipeline as the worker.

---

## Architecture Decision: React + Vite

**Decision:** Replace `apps/site` portal/admin with a React SPA in `apps/web`. Keep `apps/site` as static marketing pages.

**Why React over Alpine.js / incremental enhancement:**

| Factor                | Alpine.js (incremental) | React (new SPA)                                              |
| --------------------- | ----------------------- | ------------------------------------------------------------ |
| Solves listener leaks | Partially               | Yes — component lifecycle                                    |
| Solves global state   | No — still `window.*`   | Yes — React context / TanStack Query                         |
| Solves type safety    | No — still plain JS     | Yes — TSX + shared types                                     |
| Solves duplication    | Partially               | Yes — real components                                        |
| Solves innerHTML XSS  | No                      | Yes — JSX escapes by default                                 |
| Dev experience        | Marginal improvement    | HMR, error overlay, source maps                              |
| Migration effort      | Lower initially         | Higher initially, but the prototype code is throwaway anyway |
| Ecosystem             | Small                   | Massive — testing, a11y, forms, routing all solved           |

**The prototype portal pages are not load-bearing production code.** They're HTML mockups with inline `<script>` blocks that manually DOM-manipulate fake data. Incrementally enhancing them with Alpine.js would preserve and legitimize code that should be rewritten. A clean React app lets us start right.

### Target Stack

| Layer          | Technology                     | Why                                                                                   |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| **Build**      | Vite                           | Fast, zero-config, excellent React support                                            |
| **Framework**  | React 19 + TypeScript          | Industry standard, massive ecosystem, JSX escapes by default                          |
| **Routing**    | React Router v7                | File-based or config-based, lazy loading built in                                     |
| **API State**  | TanStack Query                 | Replaces all manual fetch + setInterval polling with cache/refetch/optimistic updates |
| **Validation** | Zod                            | Shared schemas between worker and frontend, runtime + compile-time safety             |
| **Styling**    | Tailwind CSS v4                | Already using utility-class patterns, scoped by default                               |
| **Components** | shadcn/ui (Radix primitives)   | Accessible, unstyled primitives. Copy-paste, not dependency                           |
| **Forms**      | React Hook Form + Zod          | Type-safe forms with validation                                                       |
| **Testing**    | Vitest + React Testing Library | Same test runner as worker, component-level testing                                   |
| **E2E**        | Playwright (already have it)   | Cross-browser, already set up in `tests/ui`                                           |

### Worker-Side Improvements

| Layer          | Technology  | Why                                                                                                                |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| **Router**     | Hono        | Purpose-built for CF Workers. Typed middleware, built-in CORS. Replaces ~500 lines of hand-rolled routing with ~50 |
| **DB**         | Drizzle ORM | Typed D1 queries. Schema-driven types eliminate `row["field"] as Type` casts                                       |
| **Validation** | Zod         | Shared with frontend. Validates at every API boundary                                                              |

### Static Analysis & Lint Tooling

| Tool                              | Scope                | What It Catches                                                                        |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| **ESLint** (existing, extend)     | Worker + React       | Already strict. Add `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`         |
| **TypeScript strict** (existing)  | Worker + React       | Already on with `noUncheckedIndexedAccess`. Extend to frontend                         |
| **Biome** (consider)              | Formatting + linting | 100x faster than Prettier + ESLint. Could replace both. Evaluate after React migration |
| **eslint-plugin-security**        | Worker               | Catches `innerHTML`, `eval`, prototype pollution patterns                              |
| **knip**                          | Monorepo             | Dead code detection across packages. Finds unused exports, deps, files                 |
| **publint**                       | Packages             | Validates package.json exports are correct                                             |
| **@tanstack/eslint-plugin-query** | React                | Catches common TanStack Query mistakes                                                 |

### CI Pipeline Additions

```yaml
# Add to .github/workflows/ci.yml
test-web:
  - pnpm --filter @o11yfleet/web lint
  - pnpm --filter @o11yfleet/web typecheck
  - pnpm --filter @o11yfleet/web test
  - pnpm --filter @o11yfleet/web build # catches import errors

test-e2e: # after deploy to preview
  - pnpm --filter tests-e2e test:e2e
  - pnpm --filter tests-ui test:e2e

dead-code:
  - npx knip # find unused exports, deps, files
```

---

## Migration Plan

### Phase 1: Scaffold React App (apps/web)

**Effort:** 1 session. **Risk:** None — parallel to existing site.

1. `pnpm create vite apps/web --template react-ts`
2. Add Tailwind CSS v4, React Router v7, TanStack Query
3. Add Zod, shared types from `packages/core`
4. Wire up to worker API with proper auth (cookie-based, `credentials: 'include'`)
5. Add lint/typecheck/test scripts to `package.json`
6. Add to CI pipeline

### Phase 2: Port Portal Pages

**Effort:** 2-3 sessions. Port in priority order:

1. **Auth:** Login page, auth context provider, protected route wrapper
2. **Shell:** Sidebar, topbar, theme toggle as React components (replaces portal-shell-render.js)
3. **Overview:** Dashboard with TanStack Query polling (replaces setInterval hacks)
4. **Configurations:** List + detail + CRUD (replaces 3 HTML pages)
5. **Agents:** List + detail with real-time data (fixes contract mismatches)
6. **Getting Started:** Onboarding wizard (fixes `raw_token` vs `token` bug)
7. **Settings, Tokens, Team, Billing:** Port remaining pages

### Phase 3: Port Admin Pages

**Effort:** 1-2 sessions.

1. Admin login + admin auth context
2. Admin overview, tenant list, tenant detail
3. Admin flags, health, plans

### Phase 4: Worker Modernization

**Effort:** 2-3 sessions. Can run in parallel with Phase 2-3.

1. Add Hono, migrate routes incrementally (one route group at a time)
2. Add Drizzle ORM, define schema, migrate queries
3. Add Zod request validation to all endpoints
4. Remove `?api=` URL override from `portal-api.js` / delete old portal code
5. Run knip to find/remove dead code

### Phase 5: Cleanup

1. Delete `apps/site/portal/`, `apps/site/admin/`, `apps/site/portal-*.js` (old portal code)
2. `apps/site` becomes pure static marketing site
3. `apps/web` serves portal + admin via Cloudflare Pages
4. Update `_worker.js` routing or use separate Pages project
5. Add Playwright E2E tests for critical flows (login, config CRUD, agent list)

---

## Remaining Work

### Immediate (this sprint)

- [ ] Scaffold React + Vite app in `apps/web`
- [ ] Remove `?api=` URL override security hole from `portal-api.js`
- [ ] Fix seed token comparison to use `timingSafeEqual`
- [ ] Review remaining silent catch blocks in `config-do.ts` and `event-consumer.ts`

### React Migration

- [ ] Auth pages + auth context provider
- [ ] Shell components (sidebar, topbar, theme)
- [ ] Overview dashboard with TanStack Query
- [ ] Configurations list + detail + CRUD
- [ ] Agents list + detail
- [ ] Getting started / onboarding
- [ ] Settings, tokens, team, billing pages
- [ ] Admin pages

### Worker Modernization

- [ ] Migrate to Hono router
- [ ] Add Drizzle ORM for typed D1 queries
- [ ] Add Zod validation to all API endpoints
- [ ] Consolidate triplicated route logic

### Tooling

- [ ] Add `knip` for dead code detection
- [ ] Add `eslint-plugin-security` to worker
- [ ] Add React lint plugins to web app
- [ ] Add E2E tests to CI pipeline
- [ ] Add coverage reporting
- [ ] No production Cloudflare resources required for any test
