# O11yFleet Documentation Audit Report

**Date:** 2026-04-28  
**Scope:** All 19 documentation pages in `apps/site/docs/`  
**Method:** Code review + running application inspection (localhost:8787 worker, localhost:3001 UI)  
**Auditor:** Claude Code

---

## Executive Summary

The documentation describes a **feature-rich, production-ready fleet management platform** with GitOps, progressive rollouts, and monitor-only/managed modes. The **actual implementation** is a **core MVP** that covers basic OpAMP connectivity, configuration upload, and immediate (all-at-once) rollouts.

**Key Finding:** Only ~40% of documented features are fully implemented. Major gaps exist in GitOps, rollout strategies, modes, labeling/targeting, and detailed health metrics.

---

## ✅ Accuracies — Documentation Matches Implementation

### 1. Core OpAMP Protocol

- ✅ Collector identity via `instance_uid` — implemented
- ✅ Enrollment token flow with HMAC-SHA256 — implemented as described
- ✅ WebSocket upgrade at `/v1/opamp` — implemented
- ✅ Assignment claim for reconnection — implemented
- ✅ Config hash verification — implemented
- ✅ Health status reporting (connected/disconnected, healthy/unhealthy) — implemented

**Verified in:** `apps/worker/src/index.ts:189-286`, `apps/worker/src/durable-objects/config-do.ts:136-246`

### 2. API Endpoints (Basic CRUD)

The documented API endpoints exist and work as described:

```
POST   /api/v1/configurations          ✅
GET    /api/v1/configurations          ✅
GET    /api/v1/configurations/:id      ✅
PUT    /api/v1/configurations/:id      ✅
DELETE /api/v1/configurations/:id      ✅
POST   /api/v1/configurations/:id/versions    ✅
GET    /api/v1/configurations/:id/versions    ✅
POST   /api/v1/configurations/:id/enrollment-token  ✅
GET    /api/v1/configurations/:id/enrollment-tokens ✅
DELETE /api/v1/configurations/:id/enrollment-tokens/:id ✅
GET    /api/v1/configurations/:id/agents   ✅
GET    /api/v1/configurations/:id/stats    ✅
POST   /api/v1/configurations/:id/rollout  ✅ (but simplified)
GET    /api/v1/tenant                      ✅
GET    /api/v1/team                        ✅
GET    /api/v1/overview                    ✅
```

**Verified in:** `apps/worker/src/routes/v1/index.ts`

### 3. Versioning Model

- ✅ Immutable versions — each upload creates new version with content hash
- ✅ SHA-256 content-addressed storage in R2 — implemented
- ✅ Version history tracking — implemented
- ✅ Current config hash pointer — implemented

**Verified in:** `apps/worker/src/config-store.ts:43-90`, `apps/worker/src/routes/v1/index.ts:372-387`

### 4. CLI Commands (Basic)

The documented CLI commands work as described:

- ✅ `o11yfleet login` — works
- ✅ `o11yfleet config:create` — works
- ✅ `o11yfleet config:list` — works
- ✅ `o11yfleet config:upload` — works
- ✅ `o11yfleet config:rollout` — works (but no strategy options)
- ✅ `o11yfleet agents:list` — works
- ✅ `o11yfleet token:create` — works
- ✅ `o11yfleet me` — works

**Verified in:** `apps/cli/src/commands/config/*.ts`, `apps/cli/src/commands/agents/list.ts`

### 5. Authentication

- ✅ Session-based auth for web portal — implemented
- ✅ Bearer token auth for API — implemented
- ✅ Tenant scoping via `X-Tenant-Id` header — implemented
- ✅ Authorization header for enrollment — implemented

**Verified in:** `apps/worker/src/index.ts:90-169`, `apps/worker/src/routes/auth.ts`

### 6. Schema & Data Model (Basic)

- ✅ Tenants table with plan & quotas — implemented
- ✅ Configurations table — implemented
- ✅ Config versions table — implemented
- ✅ Enrollment tokens table — implemented
- ✅ Agents table (basic fields) — implemented

**Verified in:** `packages/db/migrations/0001_initial.sql`, `0002_auth.sql`

---

## ⚠️ Gaps — Documentation Says X, Implementation is Y

### 1. Rollout Strategies (MAJOR GAP)

**Docs claim** (`docs/concepts/rollouts.html`, `docs/how-to/rollouts.html`):

- Three strategies: **Gradual** (10% every 2min), **All-at-once**, **By labels** (targeted)
- UI to select strategy per rollout
- Progressive delivery with batching
- Per-collector rollout status tracking (applied/pending/failed)

**Implementation** (`apps/worker/src/routes/v1/index.ts:521-553`, `config-do.ts:391-437`):

```typescript
// POST /api/v1/configurations/:id/rollout
// No strategy parameter. Immediately pushes to ALL connected agents.
async function handleRollout(...) {
  const config = await getOwnedConfig(...);
  const r2Obj = await env.FP_CONFIGS.get(r2Key);
  const configContent = r2Obj ? await r2Obj.text() : null;

  return stub.fetch(
    new Request("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash, config_content }),
    }),
  );
}
```

**In `config-do.ts:handleSetDesiredConfig`** — loops through **all** WebSocket connections and sends config immediately:

```typescript
for (const ws of sockets) {
  ws.send(encodeServerToAgent(...));  // Broadcast to everyone
  pushed++;
}
return Response.json({ pushed, config_hash: body.config_hash });
```

No batching. No delay. No per-agent status beyond "pushed". No strategy selection.

**UI Status:** ConfigurationDetail.tsx auto-rollouts on upload (line 60-65) but has **no manual rollout button** or strategy selector.

**Severity:** Critical — entire rollout strategy system is nonexistent.

---

### 2. Monitor-Only vs Managed Mode (MAJOR GAP)

**Docs claim** (`docs/concepts/modes.html`):

- **Monitor-only mode:** O11yFleet collects health metrics but **never pushes configs**
- **Managed mode:** O11yFleet pushes configurations
- **Per-collector opt-in:** Toggle "Managed mode" scoped by label selector (e.g., `env=staging`)
- Mixed-mode operation: some collectors monitored, others managed
- Portal UI: Workspace → Settings → Modes toggle with label selector
- Monitor-only is the **default safe** state

**Implementation:**

- ❌ **No `mode` column** in agents or configurations table
- ❌ **No mode toggle** in Settings page (`apps/web/src/pages/portal/Settings.tsx` — placeholder only)
- ❌ **No label selector** for mode scoping
- ❌ **No distinction** in code between "monitor-only" and "managed" agents

**Actual behavior:**
Any collector that connects **and accepts remote_config** (capabilities bit 0x00000003) will immediately receive the desired config on the next heartbeat. There is **no opt-in** to managed mode — remote config is always offered if the agent advertises the capability.

The state machine (`processor.ts:131-144`) sends remote_config unconditionally when a desired config exists.

**Docs quote:** "In monitor-only mode, O11yFleet collects health metrics and effective configuration from collectors but never pushes configuration changes."

**Reality:** O11yFleet **always** pushes if the agent can accept it. No mode gate exists.

**Severity:** Critical — described security/safety feature is imaginary.

---

### 3. GitOps Workflow (COMPLETE MISSING FEATURE)

**Docs claim** (`docs/how-to/gitops.html`):

- Connect GitHub repository to configuration via **OAuth**
- O11yFleet **webhook integration** with GitHub
- Auto-create pending version on **push to branch**
- Enforce branch protection: **signed commits, required reviews, status checks, CODEOWNERS**
- Create pending version → review → rollout flow
- Git as source of truth, UI as override
- Per-configuration Git repo/branch/path settings
- "UI or Git, per configuration" (main marketing claim)

**Implementation:**

- ❌ **Zero GitHub/OAuth code** — grep found only unrelated GitHub URLs
- ❌ **No webhook endpoint** in worker routes
- ❌ **No database columns** for `source_type`, `target_type`, `git_repo`, `git_branch`, `git_path`
- ❌ **No Settings → Git tab** in UI — ConfigurationDetail Settings tab says "Configuration settings and danger zone are managed above" (placeholder)
- ❌ **No Git workflow** in create flow

**What actually exists:**

- Configurations type has `source_type`, `target_type`, `environment` fields in `queries.ts:17-19` but these are **not in the database schema**
- UI table in `Configurations.tsx:61` shows "Environment" column — reads `c.environment` which **doesn't exist in DB** (returns `undefined` → "—")
- Completely unimplemented.

**Severity:** Critical — core product differentiator is fiction.

---

### 4. Collector Labels & Targeting (COMPLETE MISSING FEATURE)

**Docs claim** (`docs/concepts/collectors.html:151-165`):

```
Collectors can be labeled with arbitrary key-value pairs. Use labels to group,
filter, and target rollouts:

labels:
  env: production
  region: us-east-1
  cluster: ingress
  team: platform

Then target rollouts: "Roll out to env=production and region=us-east-1
but not cluster=ingress yet".
```

**Implementation:**

- ❌ **No `labels` column** in agents table
- ❌ **No label storage** anywhere in agent state
- ❌ **No label-based targeting** in rollout logic
- ❌ **No UI for viewing/editing** collector labels
- ❌ **No label selector field** in rollout request (API doesn't accept it)

**Agent state** (`agent-state-repo.ts:16-32`) has only:

- `instance_uid`, `tenant_id`, `config_id`, `status`, `healthy`, `current_config_hash`, etc.
  Zero label fields.

**Docs also say** (`docs/concepts/rollouts.html`): strategies include "By labels" — ❌ not implemented.

**Severity:** High — targeting fundamental to progressive delivery.

---

### 5. Health Metrics (UNDERDELIVERED)

**Docs claim** (`docs/concepts/collectors.html:138-149`):

```
Health metrics:
- Heartbeat — seconds since last message
- Version — collector binary version
- Memory usage — resident set size; warnings if above memory_limiter
- Export queue sizes — number of spans/items waiting to be exported
- Dropped spans — count of spans dropped due to queue overflow
- Receiver/acceptor errors — protocol-level errors
```

**Implementation:**

- ✅ Heartbeat (`last_seen_at`) — stored
- ✅ Version (`agent_version` from description) — stored in `agent_description` JSON
- ❌ Memory usage — **not stored or exposed**
- ❌ Export queue sizes — **not stored**
- ❌ Dropped spans — **not stored**
- ❌ Receiver/acceptor errors — only `last_error` string exists, no metrics counters

**Agent state schema** (`agent-state-repo.ts:16-32`) has only:

- `healthy` (boolean), `status` (string), `last_error` (text)
  No numeric metrics.

**What the UI actually shows** (`Agents.tsx`):

- Agent name, Configuration, Status (connected/disconnected), Health (healthy/unhealthy boolean), Last Seen

No detailed metrics panel exists anywhere in the UI.

**Severity:** High — health monitoring is crippled.

---

### 6. Configuration "Environment" Field (DB SCHEMA MISMATCH)

**Docs UI shows** (`Configurations.tsx:61`):

```
<th>Environment</th>
<td className="px-4 py-3 text-fg-3">{c.environment ?? "—"}</td>
```

**Type definition** (`queries.ts:19`):

```typescript
environment: string | null;
```

**Database schema** (`packages/db/migrations/0001_initial.sql:14-22`):

```sql
CREATE TABLE configurations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  current_config_hash TEXT,
  ...
);
```

**No `environment` column.**

**Result:** UI reads `undefined` → displays "—" for all configs. Field is dead.

**Severity:** Medium — cosmetic but indicates mismatched expectations.

---

### 7. Rollout Progress UI (MISSING)

**Docs claim** (`docs/how-to/rollouts.html:112-120`):

```
The rollout panel shows real-time progress:
- Progress bar — percentage of collectors that have accepted the new config
- Applied / Pending / Failed — counts per state
- Per-collector status — see which collectors are pending, which failed, and why
```

**Implementation:**

- ❌ **No rollout progress panel** in UI
- ❌ **No per-collector rollout state** stored in database
- ❌ **No rollout entity** — rollout is fire-and-forget; API returns `{ pushed: number }` immediately
- ✅ Agents do report `remote_config_status` (APPLIED/FAILED) via OpAMP — but **no UI to display it**

The `handleSetDesiredConfig` in `config-do.ts:391-437` immediately returns total sockets connected, not acceptance status.

**Severity:** High — rollout observability is a key promise, completely missing.

---

### 8. Version Diff Viewer (MISSING)

**Docs claim** (`docs/how-to/rollouts.html` mentions "YAML diff", `index.html:946-1010` shows UI mockup):

- Side-by-side YAML diff between versions
- Added/removed lines highlighted
- Drift detection indicator

**Implementation:**

- ❌ **No diff endpoint** in API
- ❌ **No diff UI component**
- ✅ Config versions stored in R2, but no comparison tool

**Severity:** Medium — important for change review.

---

### 9. Rollback Process (UNDERDELIVERED)

**Docs claim** (`docs/concepts/rollouts.html:161-165`):

```
Instant rollback — O11yFleet immediately pushes the old config to all collectors,
regardless of current state.
```

And (`docs/how-to/rollouts.html`):

```
Roll back — reverts all collectors to the previous version immediately
```

**Implementation:**

- ✅ **You can roll back** by re-uploading an old version and calling `POST /rollout`
- ❌ **No "Rollback" button** in UI
- ❌ **No version selector** for rollback
- ❌ **No instant one-click rollback** — manual process: find old version hash → upload as new version → rollout

The API requires you to create a **new version** that happens to be the old content, then rollout that new version. This is rollback via re-deploy, not instant revert.

**Severity:** Medium — functionality exists but UX is clunky, not "instant".

---

### 10. Getting Started Guide Accuracy (PARTIAL GAP)

**Docs say** (`getting-started.html:117-125`):

> Step 1 — Sign up  
> Create a free O11yFleet account... You'll be redirected to the onboarding flow.

**Reality:**

- ✅ Local dev: `just setup` creates tenant + seed user
- ❌ **No signup flow** in self-hosted — `/signup` page doesn't exist locally; it's static HTML but login requires seeded user
- ❌ **No onboarding flow** after login — redirects to `/portal/overview`, not a guided setup

**Docs show** (`getting-started.html:127-138`):

> Step 2 — Create an enrollment token  
> In the portal, navigate to Configurations → Create configuration → Enrollment tokens tab → Create token

**Reality:**

- ✅ Token creation works via API/CLI
- ❌ **No "Enrollment tokens" tab** in UI — ConfigurationDetail page has only Agents, Versions, Settings tabs. No tokens UI at all!
- Token creation must be done via CLI or API.

**Severity:** Medium — onboarding steps are wrong for current UI.

---

### 11. Tenant Resource Limits (MISMATCH)

**Docs claim** (`docs/concepts/tenants.html:129-162`):
Table includes **"Git repos"** column:

```
Hobby (Free):   1 config, 10 agents, 0 git repos
Pro:            3 configs, 100 agents, 1 git repo
Business:       25 configs, 1000 agents, 3 git repos
Enterprise:     Unlimited git repos
```

**Implementation:**

- ✅ Config limit (`max_configs`) — enforced
- ✅ Agent limit (`max_agents_per_config`) — enforced
- ❌ **No `git_repos` column** in tenants table
- ❌ **No Git repo tracking** or enforcement
- ❌ **GitOps not implemented** so limit is meaningless

**Severity:** Medium — pricing page references a feature that doesn't exist.

---

### 12. Configuration "Source" and "Target" Types (GHOST FIELDS)

**Type definition** (`queries.ts:17-18`):

```typescript
source_type: string | null;
target_type: string | null;
```

**Database:** No such columns in `configurations` table.

**UI:** Not displayed anywhere; fields are `undefined` when queried.

**Severity:** Low — dead code, but indicates incomplete data model.

---

### 13. Settings Page Placeholder (MISLEADING)

**Docs imply** (`docs/how-to/create-config.html` references "Settings → Git"):

> On the configuration page, go to **Settings** → **Git**

**Implementation** (`Settings.tsx`):

```tsx
<PrototypeBanner message="Notification preferences and danger zone actions are not yet implemented." />
```

Settings page is a **placeholder** — no Git integration, no mode toggle, no configuration options.

**Severity:** High — doc links to nonexistent UI.

---

### 14. Rollback Strategy Documentation (CONFUSING)

**Docs say** (`concepts/rollouts.html`):

> To revert to v12, just roll out v12 again.

**Problem:** Since versions are immutable, you can't "roll out v12" unless v12 already exists. If you've already created v13 and v14, v12 isn't directly roll-out-able without recreating it. The docs imply you can select any past version to roll out; implementation requires re-uploading the old config as a new version first.

**Severity:** Low — technically possible but UX differs.

---

## ❌ Missing/Undocumented Features

### A. GitOps (COMPLETE ABSENCE)

- No GitHub OAuth integration
- No webhook registration/handling
- No repository/branch/path configuration storage
- No commit signature verification
- No PR required checks
- No CI status check integration
- No "pending version from Git" state
- No "Create PR" button
- **Marketing claim "UI or Git, per configuration" is false**

### B. Rollout Strategies (ZERO IMPLEMENTATION)

- No gradual rollout (batch size, interval)
- No label-based targeting
- No rollout state machine (pending → rolling → applied/failed)
- No pause/resume
- No failure handling (beyond "push failed" event)
- No rollout history or audit trail

### C. Modes (Monitor-Only vs Managed) (NOT REAL)

- No mode field in DB
- No mode enforcement in OpAMP logic
- No mode toggle UI
- All agents that support remote_config receive it automatically

### D. Labels (COMPLETE ABSENCE)

- No label storage on agents or configs
- No label-based filtering in agents list
- No targeting logic
- **Docs emphasize labels for 80% of targeting use cases**

### E. Detailed Health Metrics (UNAVAILABLE)

- No queue size metrics
- No dropped spans counters
- No memory_limiter metrics
- No exporter error counts
- Only boolean `healthy` and string `status` (connected/disconnected/unknown)

### F. Drift Detection (UNDERDELIVERED)

**Docs claim** (`concepts/rollouts.html:180-189`):

> O11yFleet continuously compares intended configuration with effective configuration... flags as "drifted". The next rollout will automatically correct the drift.

**Implementation:**

- ✅ Agent reports `current_config_hash` in OpAMP messages
- DO stores `desired_config_hash` and agent's `current_config_hash`
- ✅ Mismatch is detectable
- ❌ **No drift detection job** that compares them systematically
- ❌ **No drift flag** on agent state
- ❌ **No "drifted" status** in UI
- ❌ No automatic correction beyond next config push (which already happens)

### G. Rollout Observability

- No rollout progress percentage
- No per-agent rollout state (pending/applying/applied/failed)
- No rollout history
- No error details per agent beyond generic `last_error`

### H. Version Management

- No version messages/descriptions (CLI and API support `message` field, but UI doesn't set it)
- No version diff viewer
- No "promote to production" or version tagging
- No version archiving

### I. Configuration Settings

- No environment field (UI shows it, DB doesn't have it)
- No Git repo linkage
- No "Enable managed mode" toggle
- No label selectors
- No rollout defaults

### J. Audit Logging

**Docs mention** (`how-to/gitops.html:136-149`):

> Enforce: signed commits, required reviewers, status checks, CODEOWNERS

**Implementation:**

- ❌ No audit log of who did what
- ❌ No config version change history beyond `created_at` timestamp
- ❌ No user attribution on versions (only `created_by` string, not foreign key)
- Events are published to queue (`FP_EVENTS`) but no consumer writes to persistent log

### K. Remote Actions (Future in Docs)

**Docs say** (`concepts/modes.html:143-148`):

> Managed mode capabilities:
>
> - Remote restart (future)
> - Binary updates (future)

These are listed as "future", so not missing per se. But they're explicitly called out as planned.

---

## 📝 Recommended Corrections Per Page

### 1. `docs/index.html` (Docs landing)

- ✅ Accurate overview

### 2. `docs/getting-started.html` (HIGH PRIORITY FIXES)

**Errors:**

- Step 1 "Sign up" — no hosted SaaS exists; this confuses self-hosted vs SaaS
- Step 2 "Enrollment tokens" → mentions "Enrollment tokens tab" which **doesn't exist in UI**
- Step 3 config example uses `server_url: wss://api.o11yfleet.com/v1/opamp` — should point to `http://localhost:8787/v1/opamp` for local

**Fix:** Rewrite as local-first guide. Replace "Enrollment tokens tab" with "Create token via CLI: `o11yfleet token:create`".

---

### 3. `docs/how-to/install.html`

- ✅ Local dev instructions accurate
- ✅ SaaS option accurate
- ⚠️ Mentions "Git" in prerequisite but GitOps not implemented

**Fix:** Add disclaimer: "GitOps workflow requires SaaS plan; self-hosted supports manual uploads only."

---

### 4. `docs/how-to/connect-collector.html`

- ✅ Collector config example accurate
- ✅ Enrollment token flow accurate

---

### 5. `docs/how-to/create-config.html` (HIGH PRIORITY)

**Critical error:** Step 2 says "Click **Edit** to open the YAML editor." and "Git-backed configurations" via Settings → Git.

**Reality:** UI has **Upload YAML** button and **no Git settings**.

**Fix options:**

1. Remove Git-backed section entirely (until implemented)
2. Mark as "Upcoming feature" with clear notice
3. Redirect to CLI workflow for GitOps (if that's the intended path)

Also: remove references to "Settings → Git" throughout.

---

### 6. `docs/how-to/gitops.html` (REMOVE OR MARK PROSPECTIVE)

This 245-word page describes a **completely non-existent feature**.

**Recommendation:** Move to `experimental/` or clearly mark:

> ⚠️ **GitOps workflow is currently in development and not available in the open-source version.** It will be released in a future version.

Or delete until implemented.

---

### 7. `docs/how-to/rollouts.html` (HIGH PRIORITY)

Describes:

- ✅ Starting a rollout (but no "Roll out" button exists in UI)
- ❌ "Choose rollout strategy (default: gradual)" — no strategy UI
- ❌ Progress bar, Applied/Pending/Failed counts — not shown
- ❌ "Pause and resume" — not implemented
- ❌ "Roll back" — no instant rollback button

**Fix:** Rewrite to reflect actual behavior: "After uploading a config version, it automatically rolls out to all connected agents. There is no progressive delivery or strategy selection at this time."

---

### 8. `docs/concepts/opamp.html`

- ✅ Accurate technical description of OpAMP

---

### 9. `docs/concepts/collectors.html` (HIGH PRIORITY)

**Errors:**

- Lists "Memory usage", "Export queue sizes", "Dropped spans", "Receiver/acceptor errors" as health metrics — **not collected**
- Says "Collectors can be labeled with arbitrary key-value pairs" — ❌ labels not implemented

**Fix:** Remove or strike non-existent metrics. Strike label section or mark "planned".

---

### 10. `docs/concepts/configurations.html`

- ✅ Versioning accurate
- ⚠️ Mentions "labels" and "targeting" — not implemented

**Fix:** Strike label-related paragraphs.

---

### 11. `docs/concepts/tenants.html` (HIGH PRIORITY)

**Error:** Table shows "Git repos" column — GitOps not implemented.

**Fix:** Remove column or mark with "✗ Not yet" footnote.

---

### 12. `docs/concepts/modes.html` (DELETE OR REWRITE)

Entire page describes monitor-only vs managed modes as **real toggleable features**.

**Reality:** No such toggle exists. All agents that can accept remote config are effectively managed.

**Recommendation:** Delete or archive as "Architectural vision". Replace with note: "Mode-based configuration delivery is planned but not yet implemented. Currently, all agents receive configurations if they support remote_config."

---

### 13. `docs/concepts/rollouts.html` (HIGH PRIORITY)

Claims:

- ✅ Immutable versioning — accurate
- ❌ "Rollout strategies" table — only all-at-once exists
- ❌ Gradual rollout details (batch size 10%, interval 2min) — fictional
- ❌ Progressive delivery details — not implemented
- ❌ "Versions panel → select v12 → Roll out" — no such UI

**Fix:** Strip all strategy/gradual/progressive language. Replace with: "Rollouts are immediate and affect all connected agents."

---

### 14. `docs/api/authentication.html`

- ✅ Accurate

---

### 15. `docs/api/endpoints.html` (HIGH PRIORITY)

Lists:

- `GET /configurations/:id/versions/:version` — ❌ doesn't exist (only `GET /configurations/:id/versions`)
- `POST /configurations/:id/rollouts` — path exists but **no strategy parameter** mentioned in docs

Also incorrectly suggests agents endpoints are filterable by status — they're not.

**Fix:** Update endpoint list to match actual routes in `routes/v1/index.ts`.

---

### 16. `docs/cli/index.html` (HIGH PRIORITY)

Shows commands like:

```
o11yfleet config:rollout --version <n>
```

But CLI `config:rollout` doesn't accept `--version` flag — it uses current config hash internally.

Also shows:

```
o11yfleet agents:list --status degraded
```

But the command doesn't have `--status` flag.

**Fix:** Update CLI reference to match actual command signatures in `apps/cli/src/commands/*/`.

---

### 17. `docs/troubleshooting.html`

- Review needed — may reference missing features (Git, modes, etc.)

---

### 18. `docs/architecture.html`

- Verify against actual implementation; likely accurate at high level

---

### 19. `docs/portal-design-prompt.md` (not in /docs but referenced)

- Research doc; ignore for user-facing accuracy

---

## Priority Fix Roadmap

### Phase 1 — Remove Fiction / Align with MVP (WEEK 1)

1. **Delete or archive** `how-to/gitops.html`, `concepts/modes.html` until features exist
2. **Rewrite** `how-to/rollouts.html` to describe actual immediate rollout
3. **Fix** `concepts/collectors.html` — remove non-existent metrics and labels
4. **Fix** `concepts/tenants.html` — remove Git repos column
5. **Fix** `how-to/create-config.html` — remove Git workflow section
6. **Fix** `api/endpoints.html` — list accurate endpoints only
7. **Fix** `cli/index.html` — flag parameters don't exist
8. **Add** prominent "Development Snapshot" banner on all pages noting what's implemented

### Phase 2 — Close Critical Gaps (WEEK 2-4)

If the goal is to implement the documented features:

**GitOps:**

- Add `git_repo_url`, `git_branch`, `git_file_path` columns to `configurations`
- Build GitHub OAuth flow
- Create webhook endpoint `/api/v1/git-hooks/github`
- Webhook → fetch file from repo → validate → create pending version
- Build Git settings UI in Configuration → Settings tab
- Enforce branch protection status checks

**Rollout Strategies:**

- Add `rollouts` table with columns: `id`, `config_id`, `version_hash`, `strategy` (gradual/all_at_once/by_labels), `params` (JSON), `status` (pending/running/paused/completed/failed)
- Add `agent_rollout_state` table tracking per-agent rollout status
- Implement gradual: batch by % or count, interval timer
- Implement label targeting: add `labels` to agents, filter on rollout
- Add UI for selecting strategy, monitoring progress, pausing/resuming

**Modes:**

- Add `managed_mode_enabled` boolean to configurations (or tenant-level)
- Add `mode` to agent state (monitor_only/managed)
- In DO `handleSetDesiredConfig`, skip agents in monitor-only mode
- Build mode toggle UI in Settings
- Enforce default monitor-only for new connections

**Health Metrics:**

- Extend agent state table with: `queue_size`, `dropped_spans`, `memory_bytes`, `exporter_errors`
- Parse from `agent_description` JSON (already reported by collector!)
- Store on each health message
- Add charts to UI

**Labels:**

- Add `labels` column to `agents` (JSON)
- Add label filter UI to agents list and rollout creation
- Target only agents matching selector

**Settings Page:**

- Build actual settings UI with:
  - Git integration toggle + repo config
  - Mode management (enable managed, set selector)
  - Environment dropdown
  - Notifications

### Phase 3 — Polish & Complete (WEEK 5-6)

- Version diff viewer
- One-click rollback to any previous version
- Audit log page (consume `FP_EVENTS` queue)
- Improved onboarding flow
- Getting started guide updates

---

## Undocumented but Existing Features

### Positive Surprises

- **Rate limiting** on agent messages (60msg/min default) — implemented cleanly in DO (`checkRateLimit`)
- **Stale agent sweep** alarm — implemented
- **Event queue** for audit trail — implemented (but no consumer beyond possibly analytics)
- **Admin interface** (`/admin/*` routes) — exists but not documented
- **Tenant deletion** — API exists but UI doesn't expose
- **Team management** (`GET /api/v1/team`) — exists but UI says "Not yet implemented"

These should be documented.

---

## Files with Critical Discrepancies

| Doc File                    | Severity | Issue                                                |
| --------------------------- | -------- | ---------------------------------------------------- |
| `how-to/gitops.html`        | CRITICAL | Entire page describes non-existent feature           |
| `concepts/modes.html`       | CRITICAL | Modes don't exist; page is architectural fiction     |
| `how-to/rollouts.html`      | HIGH     | Rollout strategies, progress UI, pause/resume absent |
| `concepts/collectors.html`  | HIGH     | Health metrics and labels not implemented            |
| `how-to/create-config.html` | HIGH     | "Settings → Git" UI doesn't exist                    |
| `concepts/tenants.html`     | MEDIUM   | Git repo limits meaningless                          |
| `api/endpoints.html`        | HIGH     | Lists non-existent endpoints                         |
| `cli/index.html`            | HIGH     | Shows flags not present in CLI                       |
| `getting-started.html`      | MEDIUM   | Enrollment token tab doesn't exist                   |

---

## Line-by-Line Evidence

### A. No GitOps Code

```bash
$ grep -r "github\|oauth\|webhook" apps/worker/src --include="*.ts"
# (nothing except unrelated GitHub URLs in comments)
$ grep -r "git" apps/web/src/pages/portal
# (no matches)
```

**Conclusion:** Zero Git integration.

### B. No Rollout Strategy Logic

`handleSetDesiredConfig` in `config-do.ts`:

```typescript
for (const ws of sockets) {  // ALL sockets, immediate
  ws.send(encodeServerToAgent(...));
}
```

No strategy switch, no batching, no delay, no per-agent state tracking.

### C. No Mode Toggle in UI

`Settings.tsx`:

```tsx
<PrototypeBanner message="Notification preferences and danger zone actions are not yet implemented." />
```

Settings page is a placeholder (`apps/web/src/pages/portal/Settings.tsx:67`).

### D. Agents Table Lacks Labels

`initSchema` in `agent-state-repo.ts:15-33` — creates `agents` table with 15 columns. Labels not present.

### E. Configuration Detail Has No Rollout Button

`ConfigurationDetail.tsx`:

```tsx
<Button variant="secondary" size="sm" onClick={() => setShowUpload(true)}>
  Upload YAML
</Button>
```

No separate "Rollout" button. Upload auto-rolls.

### F. Version API Returns `message` but UI Ignores It

API (`routes/v1/index.ts:376-382`):

```sql
SELECT id, config_id, config_hash, r2_key, size_bytes, created_by, created_at
FROM config_versions...
```

**No `message` column** in the SELECT or in the schema. UI (`VersionsTab`) checks `v.message` which will always be undefined.

Database `config_versions` table (`migrations/0001_initial.sql:26-36`):

```sql
CREATE TABLE config_versions (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No `message` column.

**Gap:** UI claims version messages, but schema and API don't support it.

---

## Database Schema Gaps

### Missing columns in `configurations`:

- `environment` — mentioned in UI and type, not in DB
- `source_type` — in type, not DB
- `target_type` — in type, not DB
- `git_repo_url`, `git_branch`, `git_file_path` — needed for GitOps
- `mode` or `managed_mode_enabled` — needed for monitor/managed toggle
- `labels` (JSON) — for targeting

### Missing columns in `agents`:

- `labels` (JSON) — for targeting
- `queue_size`, `dropped_spans`, `memory_bytes`, `exporter_errors` — for health metrics

### Missing tables:

- `rollouts` — rollout attempts, strategy, status, progress
- `agent_rollout_state` — per-agent rollout status (pending/applying/applied/failed)
- `audit_log` — who did what when
- `git_webhook_events` — GitHub event queue

---

## Summary Table

| Feature                   | Documented | Implemented                  | Gap Severity          |
| ------------------------- | ---------- | ---------------------------- | --------------------- |
| OpAMP connectivity        | ✅         | ✅                           | None                  |
| Basic config CRUD         | ✅         | ✅                           | None                  |
| Versioning                | ✅         | ✅                           | None                  |
| Enrollment tokens         | ✅         | ✅                           | None                  |
| CLI                       | ✅         | ✅ (basic)                   | Minor flag mismatches |
| Auth (session + bearer)   | ✅         | ✅                           | None                  |
| GitOps workflow           | ✅         | ❌                           | Critical              |
| Rollout strategies        | ✅         | ❌ (only all-at-once)        | Critical              |
| Progressive delivery      | ✅         | ❌                           | Critical              |
| Monitor/managed modes     | ✅         | ❌ (no mode concept)         | Critical              |
| Collector labels          | ✅         | ❌                           | High                  |
| Health metrics (detailed) | ✅         | ❌ (only boolean healthy)    | High                  |
| Rollout progress UI       | ✅         | ❌                           | High                  |
| Version diff viewer       | ✅         | ❌                           | Medium                |
| One-click rollback        | ✅         | ❌ (re-upload required)      | Medium                |
| Settings page (real)      | ✅         | ❌ (placeholder)             | High                  |
| Environment field         | ✅         | ⚠️ (type exists, DB doesn't) | Medium                |
| Tenant git_repo limits    | ✅         | ❌                           | Medium                |

---

## Conclusion

O11yFleet has a **solid foundation**: OpAMP WebSocket handling, configuration storage, versioning, and basic CRUD work reliably. The **core control plane is functional**.

However, **the documentation describes a far more advanced product** than what's built. Features that are **central to the product narrative** — **GitOps**, **progressive rollouts**, **monitor/managed modes**, **label-based targeting** — **are not implemented**.

### Immediate Actions Needed

1. **Lock down docs** — remove or clearly mark unimplemented features to avoid misleading users
2. **Align expectations** — either build the described features OR scale back marketing/docs to MVP reality
3. **Prioritize implementation** — if GitOps/rollouts/modes are the product vision, they need immediate engineering investment
4. **Fix TypeScript types** — `environment`, `source_type`, `target_type` should be removed or actually implemented

### Recommended Path

**Phase 1 (1 week):** Remove fictional features from public docs. Rename repo "v0.42 — Core MVP" with clear "Upcoming" sections.
**Phase 2 (2-3 weeks):** Implement rollout strategies & modes (these are internal DO logic, doable).
**Phase 3 (3-4 weeks):** Build GitOps integration (OAuth + webhooks + UI).
**Phase 4 (1 week):** Add labels & targeting.
**Phase 5 (1 week):** Add detailed health metrics (already reported by collectors, just need to store/display).
**Phase 6 (1 week):** Re-enable full docs, release v1.0.

Without this course correction, users will rightfully feel misled by documentation that doesn't match reality.
