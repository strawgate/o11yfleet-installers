# Admin Operations Model

The admin console is an operator surface for O11yFleet staff. It is not a second customer portal and should avoid unaudited customer-resource mutation.

## Responsibility Split

### Customer Portal

Customers use the portal to:

- manage configuration groups
- create versions
- roll out desired config
- enroll collectors
- inspect collector status, health, and drift
- manage workspace settings, team, billing, and tokens

### Admin Console

Staff use the admin console to:

- identify unhealthy tenants or platform dependencies
- inspect tenant metadata and support context
- review audit and platform events
- verify plan/entitlement state
- start auditable support sessions
- diagnose control-plane failures

Admin pages should make staff authority explicit and constrained.

## Health Planes

Separate these health planes everywhere:

### Control-Plane Health

Control-plane health describes O11yFleet dependencies:

- Worker/API availability
- D1
- R2
- Durable Objects
- Queues
- Analytics Engine
- auth/session services

This belongs on admin health pages.

### Runtime Fleet Health

Runtime fleet health describes customer collectors:

- connected/disconnected counts
- healthy/unhealthy counts
- drift
- rollout convergence
- collector last seen
- last error

This belongs primarily in customer tenant/fleet views and secondarily in admin tenant drilldowns.

## Event Taxonomy

Use a small event taxonomy before building event-heavy UI:

- `auth`: login, logout, failed login, session revoked
- `config`: version created, desired config changed, rollout started, rollback started
- `collector`: enrolled, connected, disconnected, health changed, config applied, config failed
- `token`: enrollment token created/revoked, API token created/revoked
- `team`: invite sent, role changed, member removed
- `billing`: plan changed, limit reached
- `support`: support session started/ended, staff inspected/mutated
- `platform`: dependency degraded/recovered, queue backlog, analytics write failure

Each event should include actor, resource, tenant, severity, timestamp, and request/correlation id where available.

## Support Workflow

The admin console should prefer this sequence:

1. Inspect tenant metadata and recent events.
2. Start a support session with a reason and TTL if customer data access is needed.
3. Step into a read-only customer view where possible.
4. Require elevated support scope for mutation.
5. Emit audit events for every scoped action.

## UI Rules

- Use the amber admin accent for staff-only surfaces.
- Label prototype/sample event data clearly.
- Do not present feature flags, plan changes, or impersonation as live mutation controls until RBAC and audit contracts exist.
- Show control-plane dependency failures separately from collector-runtime failures.
- Prefer triage clarity over dashboards that imply unavailable data.
