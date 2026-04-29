# O11yFleet Portal Design Prompt

Authoritative product semantics live in:

- `docs/product-mental-model.md`
- `docs/governance-model.md`
- `docs/admin-ops-model.md`

Follow those documents before inventing new terms. In particular, keep `workspace`, `configuration group`, `version`, `rollout`, `desired config`, `current config`, `effective config`, `collector`, `agent`, `status`, `health`, `drift`, `enrollment token`, and `API token` consistent.

You previously designed the public marketing site for O11yFleet — the hosted OpAMP control plane for OpenTelemetry Collectors. The marketing site (index.html, pricing.html, enterprise.html, product-configuration-management.html, solutions-gitops.html, about.html) uses your existing `styles.css`, `shared.js`, and `app.js` for dark/light theming with Geist fonts, oklch accent colors, scroll-reveal animations, and responsive layout.

Now we need you to design the **user portal** (the logged-in product experience for customers) and the **admin portal** (the internal operator console for us). These should feel like the natural continuation of the marketing site — same design system, same Geist fonts, same CSS variable architecture, same attention to detail — but adapted to a dense, productivity-oriented app layout rather than a marketing page layout.

---

## Design System Continuity

Reuse and extend the existing design system from `styles.css`:

- **Same CSS custom properties** (`--bg`, `--surface`, `--line`, `--fg`, `--accent`, `--ok`, `--warn`, `--err`, etc.)
- **Same `[data-theme="dark"]` / `[data-theme="light"]` toggle** with localStorage persistence
- **Same Geist + Geist Mono font stack**
- **Same component vocabulary**: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.tag`, `.tag-ok`, `.tag-warn`, `.tag-err`, `.card`, `.win` (window chrome), `.mono`, `.eyebrow`, `.diff`, `.collector-table`
- **New layout primitive needed**: a persistent sidebar + topbar app shell (the marketing site has no sidebar). The sidebar should feel like the nav-menu but vertical and fixed.
- **Accent distinction**: User portal uses the default green accent. Admin portal uses an amber/orange accent (`oklch(0.78 0.15 78)` or similar) with an "ADMIN" badge in the sidebar brand to make it instantly clear which portal you're in.

The current app implementation is the React/Vite app under `apps/site/src`. Older notes in this prompt may refer to static HTML files; preserve the information architecture and design intent, but implement against the live React pages, hooks, and shared components.

---

## Architecture Context

**Backend API** (already built):

- Auth routes: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, and API-secret-gated `POST /auth/seed`
- User routes: `GET|PUT|DELETE /api/v1/tenant`, `GET /api/v1/team`, `GET /api/v1/overview`, `POST|GET /api/v1/configurations`, `GET|PUT|DELETE /api/v1/configurations/:id`, versions, enrollment tokens, agents, stats, rollout, and YAML download
- Admin routes: `POST|GET /api/admin/tenants`, `GET|PUT|DELETE /api/admin/tenants/:id`, `GET /api/admin/tenants/:id/configurations`, `GET /api/admin/tenants/:id/users`, `GET /api/admin/health`, and `GET /api/admin/plans`
- Auth model: browser sessions come from `/auth/login` and `/auth/me`; programmatic tenant-scoped calls use `Authorization: Bearer <API_SECRET>` plus `X-Tenant-Id`; admin calls use an admin session or the same bearer secret.

**Data model**:

- **Tenant**: id, name, plan (free/pro/enterprise), max_configs, max_agents_per_config, created_at, updated_at
- **Configuration**: id, tenant_id, name, description, current_config_hash, created_at, updated_at
- **Config Version**: id, config_id, tenant_id, config_hash (SHA-256), r2_key, size_bytes, created_by, created_at
- **Enrollment Token**: id, config_id, tenant_id, token_hash, label, expires_at, revoked_at, created_at
- **Agent** (from Durable Object, not D1): instance_uid, tenant_id, config_id, status (connected/disconnected/unknown), healthy (bool), current_config_hash, last_seen_at, connected_at, last_error, agent_description, capabilities (bitmask), sequence_num, generation
- **Stats** (from Durable Object): total_agents, connected_agents, healthy_agents, desired_config_hash, active_websockets

**Pricing tiers** (from pricing.html — the portal must respect and display these):

- Hobby: Free, 1 user, monitor-only, no managed configs, no API keys
- Pro: $20/mo, 1 user, 3 managed configs, 1 GitHub repo, basic rollouts
- Team Free: Free, 3 users, monitor-only
- Business: $199/mo, 10 users, 25 configs, 3 GitHub repos, RBAC, webhooks, flow dashboards
- Enterprise: Custom, unlimited users, SSO/SCIM, advanced RBAC, approval workflows, audit export

---

## User Portal — Information Architecture

The user portal is where customers manage their collector fleet. The layout is: **persistent left sidebar** (240px) + **top bar** (breadcrumbs, search, profile dropdown) + **scrollable content area**.

### Sidebar Navigation Structure

```
[Logo] O11yFleet
────────────────
  Overview
  Configurations
  Getting Started
────────────────
ACCOUNT
  Settings
  Team (Business+ only)
  Billing
────────────────
[Org switcher at bottom]
[Profile avatar + name]
```

### Pages Required

#### 1. Auth Pages (no sidebar, centered card layout like the marketing site hero)

**Sign Up** (`signup.html`)

- Email + password form (or "Continue with Google" / "Continue with GitHub" SSO buttons)
- Organization name field
- Checkbox: "I agree to Terms and Privacy Policy" (link to marketing site)
- After signup → redirect to onboarding
- If invited: pre-filled email, "Join [Org Name]" heading, no org name field

**Log In** (`login.html`)

- Email + password, or SSO buttons
- "Forgot password?" link
- "Don't have an account? Sign up" link
- Error state: red border on inputs, error message below

**Forgot Password** (`forgot-password.html`)

- Email field → "Send reset link" button
- Success state: "Check your email" message with icon

**Accept Invite** (`accept-invite.html`)

- Shows who invited you and to which organization
- If already have account: "Sign in to accept"
- If new: sign up form pre-filled with email

#### 2. Onboarding (no sidebar, step-by-step wizard)

**Onboarding** (`onboarding.html`)

- 3-step flow with progress indicator (dots or numbered steps)
- **Step 1: "Name your workspace"** — org name (pre-filled from signup), optional display name
- **Step 2: "Create your first configuration"** — name field, optional description. Explain what a configuration group is.
- **Step 3: "Connect a collector"** — show enrollment token (generated automatically), copy button, code block with example OpAMP YAML pointing at the endpoint. "I'll do this later" skip link.
- Final: "You're all set" with link to dashboard

#### 3. Overview / Dashboard (`overview.html`)

The landing page after login. Fleet health at a glance.

**Content:**

- **Stat cards row**: Total Configurations, Total Agents (across all configs), Connected Agents, Healthy Agents, Active WebSockets
- **Configuration list** (table in a card):
  - Columns: Name, Status (tag: N connected / M total), Config Hash (truncated mono), Last Rollout (relative time), Created
  - Click row → config detail
  - Empty state: illustration + "Create your first configuration" CTA
- **Activity feed** (right column or below, optional — can be a future addition, but leave the layout space): Recent events — "Config uploaded", "Rollout completed", "3 agents disconnected". If not implementing the feed, just show the config table full width.

**Auto-refresh**: poll every 10 seconds for stats. Show "Updated 3s ago" timestamp.

#### 4. Configurations List (`configurations.html`)

- **Header**: "Configurations" title + "+ New Configuration" button (primary)
- **Table in a card**:
  - Columns: Name (bold), ID (mono, truncated), Description, Config Hash (mono, truncated), Connected Agents, Created
  - Rows are clickable → config detail
  - Plan limit indicator: "3 of 5 configurations used" (progress bar or text) below the table if approaching limit
  - If at limit: "+ New Configuration" button disabled with tooltip "Upgrade to add more configurations"
- **Empty state**: friendly message + CTA

#### 5. Configuration Detail (`configuration.html?id=UUID`)

The most important page. This is where operators spend their time.

**Header row:**

- Config name (h2, editable inline or via edit button)
- Config ID (mono, small)
- Action buttons: "Upload YAML", "Generate Token", "Rollout" (primary, with confirmation), "Settings" (gear icon → dropdown: Rename, Delete with confirmation)

**Stat cards row:**

- Total Agents, Connected (green if > 0, red if 0 but total > 0), Healthy, Active WebSockets, Desired Config Hash (mono, truncated)

**Tabbed section** (tabs below the stats):

**Tab: Agents**

- Filter bar: status dropdown (All / Connected / Disconnected), health dropdown (All / Healthy / Unhealthy)
- Agent count: "247 agents" (updates with filter)
- Table:
  - Columns: Instance UID (mono, truncated with tooltip for full), Status (dot + badge), Health (badge), Config Hash (mono, shows match/mismatch indicator vs desired), Last Seen (relative time), Connected At
  - If agent's `current_config_hash` ≠ `desired_config_hash` → show a small amber "drift" indicator
  - Pagination or "Show 100 of 1,247" with load-more. Do NOT render 10k DOM rows.
  - Click row → expandable detail? Or just a slide-out panel showing full agent info: instance_uid (full), agent_description (parsed JSON), capabilities (decoded from bitmask to human names), last_error, all timestamps

**Tab: Enrollment Tokens**

- "+ Generate Token" button (top right of tab)
- Table:
  - Columns: Label (or "(no label)"), Token ID (mono, truncated), Status (active / expired / revoked — badge), Expires (date or "Never"), Created
  - Revoke button per active token (danger style, confirm dialog)
- Token generation dialog:
  - Label (optional text input)
  - Expires (select: Never, 1h, 24h, 7d, 30d, 1y)
  - After generate: show the raw token in a mono box with copy button + red warning "Copy this token now — it won't be shown again"
  - Also show a ready-to-use YAML snippet with the token pre-filled

**Tab: Config Versions**

- "+ Upload New Version" button
- Table:
  - Columns: Config Hash (mono), Size, Created By (if available), Created At, Status (tag: "current" green for active version, "previous" dim for older)
  - Click a version row → expand to show diff vs previous version? Or at minimum show the hash and metadata.
- Upload panel (expandable or modal):
  - Drag-and-drop zone + file picker for .yaml/.yml files
  - After upload: success message with hash, size, and "Roll out now?" button

**Tab: Rollouts** (if we want to show rollout history — optional but valuable)

- Table of past rollouts: config_hash, pushed count, initiated_at, initiated_by
- Current rollout status if one is in progress (progress bar like the marketing site mockups)

**Tab: Settings** (config-level)

- Name (editable)
- Description (editable)
- Danger zone: Delete configuration (requires typing the config name to confirm, like GitHub repo deletion)

#### 6. Getting Started (`getting-started.html`)

- Numbered step-by-step guide (reuse the `steps` component from the marketing site)
- Step 1: Create a Configuration (link to configurations page)
- Step 2: Upload a YAML Config (explanation + link)
- Step 3: Generate an Enrollment Token (explanation + link)
- Step 4: Connect a Collector (code block with example OpAMP YAML, copy button)
- Step 5: Roll Out Config Changes (explanation)
- Each step should have a checkbox/completion indicator if the user has done it (query the API: has configs? has versions? has tokens? has connected agents?)

#### 7. Settings (`settings.html`)

Account and organization settings.

**Sections:**

**Profile**

- Name (editable)
- Email (read-only or editable)
- Avatar (Gravatar or upload)
- Change password button → modal

**Organization**

- Organization name (editable)
- Organization ID (mono, read-only, copy button)
- Plan badge + "Current plan: Business" with "Manage plan →" link to billing
- Plan usage: configs used/max, agents connected/max (progress bars)

**API Keys** (Pro+ plans)

- List of API keys: name, prefix (last 4 chars), created, last used, status
- "+ Create API Key" button → dialog with name, shows key once
- Revoke button per key

**Danger Zone** (card with red left border)

- "Delete organization" — requires typing org name, shows warning about data loss

#### 8. Team (`team.html`) — Business+ plans only

Team member management.

- **Header**: "Team" + "Invite member" button (primary)
- **Members table**:
  - Columns: Name, Email, Role (dropdown: Admin, Operator, Viewer — for RBAC tiers), Joined, Status (active/pending)
  - Remove button (danger) per member (except self)
  - Role change via dropdown (instant save)
- **Pending invites section**:
  - Table: Email, Role, Invited by, Sent at, Expires
  - Resend and Revoke buttons
- **Invite dialog**:
  - Email field (can paste multiple, comma-separated)
  - Role select
  - "Send invite" button
- If not on a team plan: upgrade CTA instead of the team UI

#### 9. Billing (`billing.html`)

- **Current plan card**: plan name, price, billing cycle (monthly/annual toggle?), next invoice date, payment method (last 4 of card)
- **Usage summary**: configs used/max, team members used/max, agent connections (if metered)
- **Plan comparison** (reuse the pricing page's plan cards in a smaller format with "Current" badge on active plan and "Upgrade" buttons on others)
- **Invoice history table**: date, amount, status (paid/pending/failed), PDF download link
- **Payment method section**: card on file (last 4, expiry), "Update payment method" button → Stripe-style card form
- **Cancel plan** link (danger, in small text at bottom — opens confirmation dialog explaining what happens: downgrade to free, data retention policy)

---

## Admin Portal — Information Architecture

The admin portal is for O11yFleet operators (us). Same app shell layout (sidebar + topbar) but with amber accent and "ADMIN" badge. Completely separate auth flow.

### Sidebar Navigation Structure

```
[Logo] O11yFleet [ADMIN badge]
────────────────
  Dashboard
  Tenants
────────────────
SYSTEM
  Health
  Events
────────────────
[Admin profile at bottom]
```

### Pages Required

#### 1. Admin Login (`login.html`)

- Same as user login but with amber accent
- SSO-only for production (no email/password option)
- "Admin Console" heading to make it clear

#### 2. Dashboard (`dashboard.html`)

Platform-wide KPIs at a glance.

**Stat cards row:**

- Total Tenants, Total Configurations (across all tenants), Total Connected Agents (sum across all DOs), Tenants on Free/Pro/Enterprise (breakdown)

**Recent tenants** (table in card):

- 10 most recently created tenants: Name, Plan, Configs count, Created
- Click → tenant detail

**System status:**

- API health indicator (green dot + "Healthy" or red + "Degraded")
- Workers version
- Last deploy timestamp (if available)

#### 3. Tenants List (`tenants.html`)

- **Header**: "Tenants" + "+ Create Tenant" button
- **Filter bar**: Search by name, filter by plan (All/Free/Pro/Enterprise)
- **Stat cards**: Total tenants, by plan breakdown
- **Table**:
  - Columns: Name, Plan (badge), ID (mono, truncated), Configurations, Max Configs, Max Agents/Config, Created
  - Click row → tenant detail
  - "Step In →" button per row (opens user portal scoped to that tenant in new tab)

#### 4. Tenant Detail (`tenant.html?id=UUID`)

Full admin view of a single tenant.

**Header:**

- Tenant name (h2)
- Tenant ID (mono)
- Buttons: "Step Into Portal →" (opens user portal for this tenant), "Edit" (modal), "Delete" (danger, confirmation required — blocks if tenant has configurations)

**Info cards row:**

- Plan (badge), Configurations (count / max), Max Agents/Config, Created, Last Updated

**Sections:**

**Configurations** (table in card):

- All configs for this tenant: Name, ID, Config Hash, Created
- No edit capability here — "Step In" to modify configs via the user portal

**Plan Management:**

- Current plan + limits
- "Change plan" dropdown: free → pro → enterprise (updates max_configs, max_agents)
- Show what changes on plan change

**Danger Zone:**

- Delete tenant (requires confirmation, blocks if configs exist)
- Force-disconnect all agents (emergency)

#### 5. System Health (`health.html`)

- **API status**: live healthcheck to `/healthz` endpoint, show response time
- **Component status cards**: D1 (database), R2 (config storage), Queue (events), Analytics Engine
- **Tenant health overview**: table of tenants with aggregate stats — connected agents, last activity timestamp
- **Recent errors** (if we emit structured logs — can be a placeholder for now)

#### 6. Events / Audit Log (`events.html`)

- **Filter bar**: tenant (dropdown), event type (dropdown: all, agent_connected, agent_disconnected, health_changed, config_applied, config_rejected, agent_enrolled), time range
- **Events table**:
  - Columns: Timestamp, Event Type (badge), Tenant (link), Config, Instance UID (mono), Details
  - Expandable row for full event payload
- Note: This reads from Analytics Engine — it's the audit trail
- Pagination with "Load more" (not all-at-once)

---

## Shared Components to Design

These appear across both portals:

1. **App Shell** — sidebar + topbar + content area. Topbar has: breadcrumbs (left), search (center, optional), notification bell + profile dropdown (right).

2. **Profile Dropdown** — avatar + name, links: Settings, Team, Billing (user portal) or Dashboard (admin portal), Theme toggle, Sign out.

3. **Confirmation Dialog** — used for destructive actions (delete config, delete tenant, revoke token). Has red accent, requires typing a confirmation string for critical deletes.

4. **Toast / Notification** — bottom-right, auto-dismiss after 3s. Success (green left border), error (red left border), info (blue).

5. **Empty States** — every table/list needs an empty state with: illustration or icon, heading, description, and a CTA button. Make them friendly and helpful, not just "No data."

6. **Plan Limit Warnings** — when approaching a plan limit (e.g., 4 of 5 configs used), show a subtle amber banner or badge. When at the limit, disable the action and show an upgrade CTA.

7. **Copy Button** — for IDs, tokens, config hashes. Click → copies to clipboard, shows "Copied!" tooltip for 1.5s.

8. **Relative Time** — all timestamps show relative time ("3m ago", "2h ago", "5d ago") with a title attribute showing the full ISO timestamp on hover.

9. **Pagination** — for tables with potentially many rows (agents, events). Show count, load-more button, never render >500 DOM rows.

10. **Keyboard Shortcuts** — ⌘K opens a command palette / quick search (can be a placeholder, but leave the UI hook in the topbar).

---

## Deliverables

For the **user portal**, produce these files:

```
portal/
  signup.html
  login.html
  forgot-password.html
  accept-invite.html
  onboarding.html
  overview.html
  configurations.html
  configuration.html        (detail page, reads ?id= param)
  getting-started.html
  settings.html
  team.html
  billing.html
  portal.css                (extends styles.css with app-shell layout, sidebar, tables, dialogs)
  portal.js                 (API wrapper, auth, auto-refresh, dialogs, copy, toast, pagination)
```

For the **admin portal**, produce these files:

```
admin/
  login.html
  dashboard.html
  tenants.html
  tenant.html               (detail page, reads ?id= param)
  health.html
  events.html
  admin.css                 (extends portal.css with amber accent overrides)
  admin.js                  (admin API wrapper, auth)
```

Shared across both:

```
shared/
  portal-shell.js           (sidebar toggle, topbar behavior, profile dropdown, keyboard shortcuts, notification bell)
  portal-shared.css         (app shell, sidebar, topbar, profile dropdown — imported by both portal.css and admin.css)
```

Every HTML file should be fully self-contained with realistic mock data where the API isn't wired up yet. Use the same `data-theme` toggle, same responsive breakpoints, same attention to the marketing site's level of polish. The pages should feel production-ready — not a prototype.

Reference the marketing site mockups for visual consistency: the collector inventory table, the rollout progress panel, the YAML diff viewer, the configuration version timeline — all of those visual patterns from the marketing site should appear naturally in the portal where appropriate.
