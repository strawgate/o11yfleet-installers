# o11yFleet Architecture

## Overview

o11yFleet is an OpAMP (Open Agent Management Protocol) management service built on Cloudflare's edge platform. It manages OpenTelemetry Collector agents at scale using Cloudflare Workers, Durable Objects, D1, R2, and Queues.

## Key Design Decisions

### Config-as-Durable-Object Partitioning

Each `(tenant_id, config_id)` pair maps to one Durable Object. This gives us:

- Natural sharding by configuration group
- WebSocket hibernation for idle agents (zero cost when sleeping)
- DO-internal SQLite for per-config agent state
- Automatic geographic distribution

DO name format: `${tenant_id}:${config_id}`

### Signed Assignment Claims

After enrollment, each agent receives a signed JWT-like claim (HMAC-SHA256) containing:

- `tenant_id`, `config_id`, `instance_uid`, `generation`
- Issued/expiry timestamps

Hot-path connections verify the claim locally (no D1 lookup). Only enrollment hits D1.

### R2 Content-Addressed Config Storage

Config YAML is stored in R2 keyed by SHA-256 hash:

- Key format: `configs/sha256/{hash}.yaml`
- Deduplication: identical configs share one R2 object
- Config DO references hash, never stores full YAML

### Queue-Based Read Model

Config DO emits events to a Queue on agent state changes. A consumer batches D1 upserts to `agent_summaries`. This keeps the DO fast (no D1 writes on hot path) and the read model eventually consistent.

### Offline Testing

All tests run against local miniflare/workerd runtime via `@cloudflare/vitest-pool-workers`. No production Cloudflare resources required.

## Data Flow

```
Agent → WebSocket → Worker (ingress) → Config DO → Queue → Consumer → D1
                                         ↕
                                     DO SQLite (agent state)
                                         ↕
                                     R2 (config content)
```

## Component Map

| Component      | Location                            | Runtime             |
| -------------- | ----------------------------------- | ------------------- |
| OpAMP Codec    | `packages/core/src/codec/`          | Pure TS, no CF      |
| State Machine  | `packages/core/src/state-machine/`  | Pure TS, no CF      |
| Auth/Claims    | `packages/core/src/auth/`           | Pure TS, Web Crypto |
| D1 Schema      | `packages/db/`                      | SQL                 |
| Fake Agent     | `packages/test-utils/`              | Pure TS             |
| Worker         | `apps/worker/src/index.ts`          | CF Worker           |
| Config DO      | `apps/worker/src/durable-objects/`  | CF DO               |
| Config Store   | `apps/worker/src/config-store.ts`   | CF Worker + R2      |
| Event Consumer | `apps/worker/src/event-consumer.ts` | CF Queue            |
| API Routes     | `apps/worker/src/routes/api/`       | CF Worker           |
| Terraform      | `infra/terraform/`                  | HCL                 |
