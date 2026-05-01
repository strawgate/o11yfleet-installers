# Architecture Overview

o11yFleet is one Cloudflare Worker plus one Durable Object class. The Worker owns
auth, REST APIs, OpAMP ingress, scheduled reconciliation, and admin/usage routes.
The Durable Object owns live collector sessions for one `(tenant_id, config_id)`.

## Runtime Planes

| Plane               | Source of truth                               | Responsibilities                                                          |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Auth                | D1                                            | Users, sessions, seed accounts, tenant/admin role checks                  |
| Management API      | D1 + R2 + DO reads                            | Tenant/config/token CRUD, config versions, rollout commands, admin views  |
| Agent control plane | Durable Object SQLite + hibernated WebSockets | Enrollment handoff, reconnects, applied config delivery, live agent state |
| Metrics/read model  | Durable Object SQLite + Analytics Engine      | Live state, aggregate snapshots, usage signals                            |

## Data Flow

```text
Collector
  -> /v1/opamp Worker ingress
  -> Config DO named tenant_id:config_id
  -> DO SQLite for live state and applied config delivery
  -> Analytics Engine for aggregate metrics snapshots

Portal/Admin
  -> /auth/* for cookie sessions
  -> /api/v1/* for tenant-scoped customer actions
  -> /api/admin/* for staff-only views and impersonation
  -> R2 for immutable config YAML by content hash
```

## Durable Object Partitioning

Each configuration group maps to one Config DO named `${tenant_id}:${config_id}`.
This gives natural sharding by assignment boundary, local SQLite for fast live
state, and Cloudflare WebSocket hibernation for idle collectors.

The DO is authoritative for:

- connected WebSocket count
- agent status, health, last-seen, and current config hash
- applied desired-config snapshot for live delivery
- immediate remote-config broadcast to connected collectors

D1 stays authoritative for:

- tenants/workspaces
- users and sessions
- configuration metadata
- config versions and R2 object references
- enrollment tokens
- admin cross-tenant queries

Account, workspace, and configuration-group settings follow the ownership rules
in [settings-plan](settings-plan.md). The short rule is that D1 owns durable
product settings and declared rollout intent, Config DOs own live
per-configuration coordination and applied delivery snapshots, R2 owns immutable
config artifacts, and Worker bindings/secrets own deployment bootstrap.

## Enrollment And Reconnects

First contact uses a D1-backed enrollment token scoped to one tenant and config.
After enrollment, the Worker issues a signed assignment claim containing
`tenant_id`, `config_id`, `instance_uid`, `generation`, and issued/expiry times.

Reconnects verify the HMAC claim locally and route directly to the Config DO. The
hot path does not hit D1.

## Config Storage And Rollout

Config YAML is stored in R2 by SHA-256:

```text
configs/sha256/{hash}.yaml
```

Upload validates YAML, stores content, and writes D1 version metadata. Rollout is
a separate D1-declared action that sends the selected hash/content and generation
to the Config DO. The DO updates its applied delivery snapshot and pushes remote
config to connected collectors that advertise remote-config support.

## Metrics And Observability

The WebSocket hot path does not write D1. The Config DO stores live state in
DO-local SQLite and emits compact aggregate metrics to Analytics Engine from
alarms and sweep reconciliation. Config rejection details are written as
structured Worker logs so they show up in Cloudflare Workers Logs/Logpush
without making an event queue a correctness dependency.

The Worker also runs a daily UTC `0 0 * * *` cron that emits product-level
tenant plan counts to Analytics Engine. That job is separate from the
per-config DO alarm path. The `17 3 * * *` cron is reserved for stale-agent
reconciliation.

## Component Map

| Component                              | Location                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| OpAMP codec/state machine/auth helpers | `packages/core/src/`                                                             |
| API/Pipeline graph/YAML/AI contracts   | `packages/core/src/api/`, `packages/core/src/pipeline/`, `packages/core/src/ai/` |
| D1 schema                              | `packages/db/`                                                                   |
| Worker entrypoint                      | `apps/worker/src/index.ts`                                                       |
| Config DO                              | `apps/worker/src/durable-objects/`                                               |
| API routes                             | `apps/worker/src/routes/`                                                        |
| React site                             | `apps/site/`                                                                     |
| CLI                                    | `apps/cli/`                                                                      |
| Terraform                              | `infra/terraform/`                                                               |
