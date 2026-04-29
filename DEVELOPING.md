# O11yFleet Development Notes

## TL;DR

The app has three planes: **Agent Control Plane** (Durable Object), **Management API**
(Worker), and **Auth** (D1-backed sessions plus a deployment bearer secret). The
React site is wired to the current API for the customer portal and admin console.
Live collector state lives in the Config Durable Object; D1 owns relational data;
R2 stores config YAML; Queues and Analytics Engine carry event/usage signals.

---

## Current State (What's Already Real)

| Component                            | Status     | Notes                                                           |
| ------------------------------------ | ---------- | --------------------------------------------------------------- |
| Agent enrollment (token → DO)        | ✅ Working | WebSocket enrollment with signed claims                         |
| Agent reconnect (claim → DO)         | ✅ Working | Zero-DB hot path, HMAC verified locally                         |
| Config DO (per tenant:config)        | ✅ Working | SQLite-backed, WebSocket hibernation, stale detection           |
| Config push (rollout → DO broadcast) | ✅ Working | `set-desired-config` command, inline YAML                       |
| R2 config storage                    | ✅ Working | Content-addressed, SHA-256 dedup                                |
| D1 schema                            | ✅ Working | Tenants, configs, versions, tokens, users, sessions             |
| Tenant API                           | ✅ Working | `/api/v1/*`, scoped by tenant session or bearer + `X-Tenant-Id` |
| Admin API                            | ✅ Working | `/api/admin/*`, scoped by admin session or bearer `API_SECRET`  |
| Queue consumer (events → analytics)  | ✅ Working | Writes to Analytics Engine                                      |
| Auth                                 | ✅ Working | Cookie sessions for UI, `API_SECRET` for bootstrap/automation   |
| Portal UI → real API                 | ✅ Working | React portal pages use API hooks and TanStack Query             |
| Admin UI → real API                  | ✅ Working | Overview, tenants, health, usage, support, DO viewer, plans     |

**Key insight**: the management API and browser apps are real now. Most remaining
work is product depth: richer rollout state, RBAC, audit events, team invites,
billing integration, and production identity/SSO.

---

## Architecture: Three Planes

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │  Auth Layer   │  │  Management API  │  │  OpAMP Ingress        │ │
│  │              │  │  /api/v1/*        │  │  /v1/opamp            │ │
│  │  POST /auth/ │  │  /api/admin/*     │  │                       │ │
│  │  login       │  │                  │  │  enrollment (cold)    │ │
│  │  session     │  │  reads D1        │  │  reconnect (hot)      │ │
│  │  verify      │  │  reads DO (stats)│  │                       │ │
│  └──────┬───────┘  └────────┬─────────┘  └───────────┬───────────┘ │
│         │                   │                         │             │
│         ▼                   ▼                         ▼             │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │  D1: users   │  │  D1: tenants,    │  │  Durable Object       │ │
│  │  sessions    │  │  configs, tokens │  │  CONFIG_DO             │ │
│  │  tenant_     │  │                  │  │  (per tenant:config)  │ │
│  │  members     │  │  R2: config YAML │  │                       │ │
│  │              │  │                  │  │  SQLite: agents,      │ │
│  │              │  │  DO: agent stats │  │  desired_config       │ │
│  └──────────────┘  └──────────────────┘  └───────────────────────┘ │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Queue Consumer: events → Analytics Engine (existing)         │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Plane 1: Agent Control Plane (DO) — Already Built

**What it does**: Manages real-time agent connections, config delivery, health tracking.

**What the Management API queries from DO**:

- `GET /stats` → `{ total, connected, healthy, websocket_count }` — for dashboard KPIs
- `GET /agents` → full agent list with status, health, config hash, last_seen — for agent list/detail pages
- `POST /command/set-desired-config` → broadcasts new config to all connected agents — for rollout

**What stays in D1 (not DO)**:

- Tenant/config/token CRUD — low-frequency, relational, needs cross-tenant queries for admin
- Config version history — audit trail, R2 references
- User accounts and sessions — auth is a global concern

**Why this split is right**: DO is the authoritative source for real-time agent state. D1 is the authoritative source for everything else. The management API reads from both. No data duplication needed.

### Plane 2: Management API (Worker) — Built

The Worker owns:

- Auth routes: `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/seed`
- Tenant routes: `/api/v1/*`
- Admin routes: `/api/admin/*`
- OpAMP ingress: `/v1/opamp`
- Health check: `/healthz`

### Plane 3: Auth Layer — Built

The UI uses HTTP-only `fp_session` cookies. Programmatic setup and local scripts
use `Authorization: Bearer <API_SECRET>`. Tenant-scoped bearer calls must also
send `X-Tenant-Id`.

---

## Auth Model

### Current Requirements

- Hardcoded tenant user and admin user via env vars (until social auth)
- Session-based (HTTP-only cookies) for portal/admin UI
- Bearer token stays for programmatic API access
- Multi-tenant: user belongs to a tenant
- Admin: separate role, can see all tenants

### D1 Tables

```sql
-- Users (hardcoded for now, social auth later)
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,         -- argon2id via WebCrypto
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'member' | 'admin'
  tenant_id TEXT REFERENCES tenants(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions (cookie-based for portal UI)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- random 32-byte hex
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

### Seed Accounts (via env vars)

```jsonc
// wrangler.jsonc vars (dev) or secrets (prod)
{
  "SEED_TENANT_USER_EMAIL": "demo@o11yfleet.com",
  "SEED_TENANT_USER_PASSWORD": "demo-password-change-me",
  "SEED_ADMIN_EMAIL": "admin@o11yfleet.com",
  "SEED_ADMIN_PASSWORD": "admin-password-change-me",
}
```

`POST /auth/seed` creates or updates these accounts. The tenant user is associated
with the demo tenant. The admin user gets `role: 'admin'` with no tenant and can
access the admin console.

### Auth Endpoints

```http
POST /auth/login        { email, password } → Set-Cookie: fp_session=<id>; HttpOnly; Secure; SameSite=Lax; Path=/
POST /auth/logout       → Clear cookie, delete session from D1
GET  /auth/me           → { user: { id, email, display_name, role, tenant_id } }
POST /auth/seed         → Creates configured seed accounts, guarded by API_SECRET
```

### Auth Middleware

```typescript
type AuthContext = {
  userId: string;
  tenantId: string | null; // null for admins
  role: "member" | "admin";
};

async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  // 1. Check cookie (portal UI)
  const sessionId = getCookie(request, "fp_session");
  if (sessionId) {
    const session = await env.FP_DB.prepare(
      'SELECT s.user_id, u.tenant_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")',
    )
      .bind(sessionId)
      .first();
    if (session)
      return { userId: session.user_id, tenantId: session.tenant_id, role: session.role };
  }

  // 2. Check Bearer token (programmatic API — existing API_SECRET check)
  // Keep existing behavior: API_SECRET grants full access
  // Later: per-user API keys

  return null;
}
```

### How Auth Flows Into Existing Routes

**`/api/v1/*` routes** resolve tenant scope this way:

- Cookie auth → `tenantId` comes from `session.user.tenant_id`
- Bearer API_SECRET → `tenantId` comes from `X-Tenant-Id`
- No auth → 401

**`/api/admin/*` routes** resolve admin scope this way:

- Cookie auth → must have `role: 'admin'`
- Bearer API_SECRET → allowed for bootstrap and controlled automation
- No auth or tenant-only session → 403

**`/v1/opamp`** — unchanged. Uses enrollment tokens / assignment claims, not user sessions.

---

## What the Management API Needs From the DO

The portal UI needs these data flows:

| Portal Page           | Data Source                | Endpoint                                                     |
| --------------------- | -------------------------- | ------------------------------------------------------------ |
| Overview (KPIs)       | DO `/stats` per config     | `GET /api/v1/configurations/:id/stats` ✅ exists             |
| Overview (aggregate)  | D1 count + sum of DO stats | `GET /api/v1/overview` ✅ exists                             |
| Configurations list   | D1                         | `GET /api/v1/configurations` ✅ exists                       |
| Configuration detail  | D1 + DO stats              | `GET /api/v1/configurations/:id` ✅ exists                   |
| Agents list           | DO `/agents`               | `GET /api/v1/configurations/:id/agents` ✅ exists            |
| Agent detail          | DO `/agents` (filtered)    | `GET /api/v1/configurations/:id/agents/:uid` ✅ exists       |
| Config versions       | D1                         | `GET /api/v1/configurations/:id/versions` ✅ exists          |
| Enrollment tokens     | D1                         | `GET /api/v1/configurations/:id/enrollment-tokens` ✅ exists |
| Settings (workspace)  | D1                         | `GET /api/v1/tenant` ✅ exists                               |
| Rollout (push config) | DO command                 | `POST /api/v1/configurations/:id/rollout` ✅ exists          |

### Current Aggregate Endpoints

```http
GET  /api/v1/overview
  → Iterates tenant's configs, calls each DO's /stats, aggregates:
    { total_agents, connected_agents, healthy_agents, configs_count, configurations: [{id, name, stats}] }

GET  /api/v1/configurations/:id/agents/:uid
  → Calls DO /agents, filters to single agent, returns detail

PUT  /api/v1/tenant
  → Update tenant name (user self-service)

GET  /api/admin/overview
  → { total_tenants, total_configurations, total_active_tokens, total_users, total_agents,
      connected_agents, healthy_agents }

POST /api/admin/tenants/:id/impersonate
  → Creates a tenant-scoped browser session for admin troubleshooting.
```

### How Config Gets to Agents (Full Flow)

```
User uploads YAML → POST /api/v1/configurations/:id/versions
  1. Worker validates YAML, computes SHA-256
  2. Stores to R2 at configs/sha256/{hash}.yaml
  3. Inserts config_versions row in D1
  4. Updates configurations.current_config_hash in D1
  5. Returns { hash, version_id }

User clicks "Roll out" → POST /api/v1/configurations/:id/rollout
  1. Worker reads current_config_hash + YAML from R2
  2. Calls DO POST /command/set-desired-config { hash, content }
  3. DO stores in do_config table (SQLite)
  4. DO iterates all connected WebSockets
  5. For each agent with AcceptsRemoteConfig capability:
     - If agent's current_config_hash != desired → sends ServerToAgent with remote_config
  6. Agents ACK → DO emits CONFIG_APPLIED events → Queue → Analytics
```

This is a two-step process by design: upload is separate from rollout. This lets users upload, review, then push — or upload and auto-rollout later.

---

## Service Inventory (Nothing New Needed)

| Service                      | Runtime                 | Already Exists? |
| ---------------------------- | ----------------------- | --------------- |
| Worker (API + OpAMP ingress) | Cloudflare Worker       | ✅              |
| Config DO                    | Durable Object (SQLite) | ✅              |
| D1 (relational data)         | Cloudflare D1           | ✅              |
| R2 (config blobs)            | Cloudflare R2           | ✅              |
| Queue (events)               | Cloudflare Queue        | ✅              |
| Analytics Engine             | Cloudflare AE           | ✅              |
| Site (portal UI)             | Cloudflare Pages        | ✅              |

**No new services.** Everything runs in one Worker with one DO class. The Worker is the management API, the auth layer, and the OpAMP ingress — all in one. This is fine because:

- Cloudflare Workers are stateless and scale horizontally
- The DO handles all per-config stateful concerns
- D1 handles all relational/auth concerns
- There's no background processing that needs a separate service

---

## Current Gaps

- Self-service signup and password reset pages are UI placeholders; seed/bootstrap creates accounts.
- Team invites, RBAC beyond `member`/`admin`, and per-user API keys are not implemented.
- Audit events are a product requirement but not a complete user-facing surface yet.
- Rollout strategies are still simple immediate pushes to connected collectors.
- Billing is plan/limit display only; there is no payment-provider integration.

---

## Env Vars / Secrets Summary

See [DEPLOY.md](DEPLOY.md) for the current deployment credentials, Worker runtime secrets, and
Cloudflare analytics requirements. Keep this section focused on the auth implementation notes that
motivated the first seed-account rollout.

```jsonc
// Core runtime:
"API_SECRET": "...",
"CLAIM_SECRET": "...",

// Seed/bootstrap:
"SEED_TENANT_USER_EMAIL": "demo@o11yfleet.com",
"SEED_TENANT_USER_PASSWORD": "...",      // strong random password
"SEED_ADMIN_EMAIL": "admin@o11yfleet.com",
"SEED_ADMIN_PASSWORD": "..."             // strong random password
```

---

## Decision Log

| Decision                               | Rationale                                                                                                        | Alternative Considered         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| One Worker, not microservices          | CF Workers scale horizontally; splitting adds latency + complexity for zero benefit at this scale                | Separate auth worker           |
| Sessions in D1, not KV                 | Sessions are relational (join to users), KV doesn't support TTL cleanup queries                                  | Cloudflare KV with TTL         |
| PBKDF2 not Argon2id                    | Workers runtime doesn't expose Argon2id via WebCrypto; PBKDF2 with 600k iterations is OWASP-recommended fallback | bcrypt (not in WebCrypto)      |
| Cookie auth for portal, Bearer for API | Portal needs HttpOnly cookies for XSS protection; API clients need Bearer tokens                                 | JWT in localStorage (XSS risk) |
| Hardcoded accounts via env vars        | Gets us to "real" auth without building registration/OAuth; env vars are easy to rotate                          | Auto-create on first visit     |
| Two-step upload+rollout                | Matches real workflow: review config before pushing to fleet                                                     | Auto-rollout on upload         |
| DO is source of truth for agent state  | Agent state changes too fast for D1 writes; DO SQLite handles it in-memory                                       | Write-through to D1            |
| No separate "user API keys" yet        | API_SECRET covers programmatic access; per-user keys are a v2 feature                                            | Implement now                  |

---

## Frontend Styling Direction

The React site now supports Tailwind CSS v4 and shadcn-compatible local primitives. Existing marketing,
portal, and admin screens still use the custom CSS files under `apps/site/src/styles`; do not rewrite stable
screens just to move classes around.

Use Tailwind and `apps/site/src/components/ui/*` for new interactive product surfaces, especially AI UI,
command/search, popovers, dialogs, tool-call displays, editor affordances, and other state-heavy controls.
Keep those primitives aliased to the existing O11yFleet CSS variables in `styles.css` so dark/light mode and
the current visual language stay consistent.

Guidelines:

- Prefer local primitives from `@/components/ui/*` over one-off button/input/dialog markup for new work.
- Add new shadcn-style primitives only when a feature needs them; keep generated code reviewed and trimmed.
- Keep page layouts and legacy CSS stable until a page is already being materially changed.
- AI Elements can be used as a source registry for patterns, but avoid wholesale installation unless the
  component fits our local primitive layer and passes typecheck/build without introducing a second design
  language.
