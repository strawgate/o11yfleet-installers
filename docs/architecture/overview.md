# Architecture Overview

o11yFleet is one Cloudflare Worker plus one Durable Object class. The Worker owns
auth, REST APIs, OpAMP ingress, Queue consumption, and admin/usage routes. The
Durable Object owns live collector sessions for one `(tenant_id, config_id)`.

## Runtime Planes

| Plane               | Source of truth                               | Responsibilities                                                         |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Auth                | D1                                            | Users, sessions, seed accounts, tenant/admin role checks                 |
| Management API      | D1 + R2 + DO reads                            | Tenant/config/token CRUD, config versions, rollout commands, admin views |
| Agent control plane | Durable Object SQLite + hibernated WebSockets | Enrollment handoff, reconnects, desired config, live agent state         |
| Event/read model    | Queue + D1 + Analytics Engine                 | Batched state summaries, usage signals, historical analytics             |

## Data Flow

```text
Collector
  -> /v1/opamp Worker ingress
  -> Config DO named tenant_id:config_id
  -> DO SQLite for live state and desired config
  -> Queue for state/config events
  -> D1 and Analytics Engine read models

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
- desired config for that configuration group
- immediate remote-config broadcast

D1 stays authoritative for:

- tenants/workspaces
- users and sessions
- configuration metadata
- config versions and R2 object references
- enrollment tokens
- admin cross-tenant queries

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
a separate action that sends the selected hash/content to the Config DO. The DO
updates desired state and pushes remote config to connected collectors that
advertise remote-config support.

## Events

The WebSocket hot path does not write D1. The DO buffers events in SQLite and an
alarm drains them to Cloudflare Queues in batches. The Queue consumer updates D1
read models and Analytics Engine.

Event categories should stay small and explicit:

- `auth`
- `config`
- `collector`
- `token`
- `team`
- `billing`
- `support`
- `platform`

## Component Map

| Component                              | Location                                               |
| -------------------------------------- | ------------------------------------------------------ |
| OpAMP codec/state machine/auth helpers | `packages/core/src/`                                   |
| Pipeline graph/YAML/AI contracts       | `packages/core/src/pipeline/`, `packages/core/src/ai/` |
| D1 schema                              | `packages/db/`                                         |
| Worker entrypoint                      | `apps/worker/src/index.ts`                             |
| Config DO                              | `apps/worker/src/durable-objects/`                     |
| API routes                             | `apps/worker/src/routes/`                              |
| React site                             | `apps/site/`                                           |
| CLI                                    | `apps/cli/`                                            |
| Terraform                              | `infra/terraform/`                                     |
