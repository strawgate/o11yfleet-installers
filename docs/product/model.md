# Product Model

This is the shared language for portal copy, admin workflows, docs, and agent
prompts. It intentionally separates current behavior from planned governance.

## Core Entities

| Term                | Meaning                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace           | Customer-facing tenant boundary. Use `workspace` in customer UI and `tenant` in backend/admin internals.                                                             |
| Configuration group | Assignment boundary for a set of collectors. Avoid casually renaming this to `fleet` or `policy`.                                                                    |
| Collector           | Running OpenTelemetry Collector process.                                                                                                                             |
| Agent               | Managed OpAMP identity for a collector, keyed by `instance_uid`.                                                                                                     |
| Enrollment token    | Bootstrap secret for enrolling collectors into one workspace and configuration group. Not an API key.                                                                |
| Version             | Immutable YAML snapshot keyed by content hash and stored in R2.                                                                                                      |
| Desired config      | Version hash/content selected by the control plane for a configuration group.                                                                                        |
| Current config      | What a collector reports through OpAMP, usually as `current_config_hash`.                                                                                            |
| Effective config    | Future diagnostic concept for runtime config after remote config, bootstrap config, and fallback behavior. Do not claim exact behavior until the backend exposes it. |
| Rollout             | Promotion of a version to desired state for a configuration group.                                                                                                   |
| Rollback            | Promotion of an older version. Versions are never mutated in place.                                                                                                  |

## Status Language

- `connected`: active management session.
- `disconnected`: no active session.
- `unknown`: not yet observed or not reported.
- `healthy` / `unhealthy`: runtime health, separate from connection status.
- `drift`: desired config hash differs from reported current config hash.
- `last seen`: most recent heartbeat or state update.
- `connected at`: timestamp for the current active session.

Show status, health, and drift separately. Do not imply that token creation means
first-run success; success requires a collector connection and report.

## Governance Model

O11yFleet controls remote collector configuration, so permission boundaries are
core product behavior.

Current implementation:

- tenant/member and admin users
- HTTP-only browser sessions
- deployment bearer secret for bootstrap and controlled automation
- tenant impersonation from admin tenant detail pages
- plan/limit display without billing-provider mutation

Planned model:

- roles: `viewer`, `operator`, `admin`, `owner`
- per-user/API-token scopes
- team invites
- audit-event UI
- support sessions with reason, TTL, scope, and visible customer banner
- plan gates for monitor-only mode, managed configurations, team size, API tokens,
  RBAC depth, SSO/SCIM, audit export, and approval workflows

Mutation endpoints must enforce permissions server-side; hidden buttons are not a
security boundary.

Pricing and packaging details live in [pricing](pricing.md). The short rule:
fleet visibility can be generous; production governance, automation, history,
RBAC, audit, SSO, and rollout safety are the paid boundaries.

## Admin Operations

The admin console is a staff troubleshooting surface, not a second customer
portal.

Staff should use admin pages to:

- identify unhealthy tenants or platform dependencies
- inspect tenant metadata and plan/entitlement state
- review platform health, usage, and Durable Object state
- impersonate a tenant-scoped portal session for troubleshooting
- diagnose control-plane failures

Admin pages must keep staff authority explicit. Impersonation should remain
highly visible in the customer portal while active.

Separate health planes:

| Plane                | Belongs in                                 | Examples                                                                                                   |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Control-plane health | Admin health                               | Worker/API, D1, R2, Durable Objects, Queues, Analytics Engine, auth/session services                       |
| Runtime fleet health | Customer portal and admin tenant drilldown | connected/disconnected counts, healthy/unhealthy counts, drift, rollout convergence, last seen, last error |

## UI Rules

- Use the amber admin accent for staff-only surfaces.
- Mark prototype/sample surfaces clearly.
- Do not present feature flags, billing, plans, or audit controls as live mutation
  surfaces until backend contracts exist.
- Prefer disabled controls with concrete reasons over invisible plan/role gates.
- Keep destructive and remote-config-authority actions visibly auditable.
- Do not render large collector lists without pagination, load-more, or
  server-side query support.
