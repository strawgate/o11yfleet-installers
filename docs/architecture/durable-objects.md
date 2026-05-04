# ConfigDurableObject — OpAMP Agent Management

The `ConfigDurableObject` (`apps/worker/src/durable-objects/config-do.ts`)
is the central stateful actor for OpAMP agents within a single
`tenant:config` pair. One DO exists per configuration; agents connect via
the WebSocket Hibernation API.

## Architecture

```
CF Edge ──── Worker (stateless) ──── ConfigDO (stateful, per-config)
                                       ├─ DO-local SQLite (agents,
                                       │   config, policy, events)
                                       ├─ WebSocket Hibernation API
                                       └─ Alarm (deferred metrics)
```

Each DO manages up to 30K concurrent agents. The DO is the only writer to
its SQLite — no contention, no distributed locks.

## Cloudflare billing model

Every design decision below is driven by the relative cost of operations:

| Resource                   | Cost        | Notes                    |
| -------------------------- | ----------- | ------------------------ |
| DO request                 | $0.15 / 1M  | Each WS message = 1 req  |
| Duration (GB-s)            | $12.50 / 1M | Wall-clock while active  |
| SQLite row read            | $0.001 / 1M | Per SELECT row returned  |
| SQLite row write           | $1.00 / 1M  | Per INSERT/UPDATE row    |
| KV get / `getAlarm`        | $0.20 / 1M  | Legacy KV-style reads    |
| KV put / `setAlarm`        | $1.00 / 1M  | Legacy KV-style writes   |
| WS attachment r/w          | FREE        | In-memory, survives hib. |
| `getWebSockets()`          | FREE        | Runtime memory operation |
| `setWebSocketAutoResponse` | FREE        | Edge ping/pong, no wake  |

**Key insight:** SQL reads are 200× cheaper than KV reads, and 1000×
cheaper than writes. Every optimization targets write elimination.

`getAlarm()`/`setAlarm()` may be billed as KV storage ops or as standard
DO requests depending on backend (CF docs are ambiguous). Either way,
they involve an async boundary that is avoided on hot paths via the
`alarmScheduled` guard.

## Persistence tier system

Every WebSocket message is classified into a persistence tier based on
what changed. This minimizes SQLite writes (the most expensive billable
operation) while keeping state accurate.

### Tier 0 — No-op heartbeat (95% of traffic)

Agent reports same state as last time. **Zero SQL writes.** `seq_num` and
`last_seen_at` track in the WS attachment (free). Flushed to SQLite only
on disconnect (`markDisconnected`). Cost: 1 SQL read (`loadAgentState`;
`getDesiredConfig` is cached), 0 writes, 0 KV ops.

### Tier 1 — Partial update (4% of traffic)

A field changed (health, effective_config, etc.) but not a lifecycle
event. Targeted UPDATE writes only dirty columns. Cost: 1 SQL read +
1 SQL write + `ensureAlarm` if events are emitted.

### Tier 2 — Full UPSERT (1% of traffic)

First message, reconnect, disconnect, or generation bump. Full
16-column UPSERT because config-do mutates fields (`generation`,
`connected_at`, `status`) outside `processFrame` → `dirtyFields` won't
include them. Also needed when no row exists yet. Cost: 1-3 SQL reads

- 1-2 SQL writes (policy/config cached).

The key to Tier 0 being free: `attachment.sequence_num` and
`attachment.last_seen_at` track session-scoped state that would otherwise
require a SQL write per heartbeat. These are flushed to SQLite on
`webSocketClose → markDisconnected`, ensuring metrics and stale sweeps
stay accurate without per-heartbeat write cost.

## Hibernation safety

This DO uses the WebSocket Hibernation API, which means the runtime may
evict the DO from memory between messages. On next message:

- `constructor()` runs again (all instance fields reset)
- SQLite is still there (durable)
- WS attachments survive (managed by runtime, not JS heap)
- In-memory caches reset to `null`/`false` — this is **correct**:
  conservative on wake-up, rebuilt on first access

**Rule:** never store truth in instance fields that can't be rebuilt
from SQLite or WS attachments. Caches are OK (stale = slower, not
wrong). Flags that default to `false`/conservative are OK.

## WebSocket close/error flow

When a WebSocket closes (clean or error), the DO must:

1. Flush attachment state (`last_seen_at`, `seq_num`) to SQLite
2. Mark agent as disconnected in SQLite
3. Maybe schedule an alarm for metrics emission

The subtle part is step 3: if `processFrame` already handled a clean
`agent_disconnect` message (OpAMP §3.1.7), it already set
`status='disconnected'` and the alarm was already scheduled. In that
case `ensureAlarm()` is skipped to avoid an unnecessary async call.

Detection works by loading agent state **before** `markDisconnected`:

```ts
state = loadAgentState(...)  // 1 SQL read ($0.001/M — cheap)
markDisconnected(...)        // 1 SQL write ($1/M — happens anyway)
if (state.status === "disconnected") return  // skip alarm
ensureAlarm()                // avoided when processFrame handled it
```

`getDesiredConfig()` is needed to build the correct `config_hash` for
`loadAgentState`. Since it's cached in memory, this is free after the
first call in a wake cycle.

## Cost model at scale

30K agents, 1hr heartbeat, 95% no-op:

- Steady-state: ~$3.24/mo (mostly DO request + duration)
- SQL writes are dominated by enrollment (Tier 2) + disconnect
- SQL reads: ~500/min heartbeat reads → well within free tier
- KV ops: alarm-related only, <100K/mo → within free tier

The architecture is designed so that **ongoing cost is near-zero**.
Enrollment is the expensive event; heartbeats are essentially free.
