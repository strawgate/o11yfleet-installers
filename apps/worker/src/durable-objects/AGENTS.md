# Durable Objects — Storage Cost Rules

This document is the authoritative guide for anyone modifying SQLite usage
in the Config Durable Object. Read it before adding columns, indexes, or
new SQL statements.

## The One Rule

**Writes cost 1000× more than reads. Every design decision flows from this.**

| Resource     | Cost per million | Relative  |
| ------------ | ---------------- | --------- |
| Rows read    | $0.001           | 1×        |
| Rows written | $1.00            | **1000×** |

At 100K collectors sending 1 heartbeat/hour:

- 2.4M messages/day
- If each message writes 1 row: **$72/month**
- If each message writes 6 rows (current, with indexes): **$432/month**
- If no-op messages write 0 rows (target): **~$7/month**

## Index Rules

### Every index multiplies your write cost

Each index on a table adds +1 billed row written **per write operation**
on that table, regardless of whether the indexed column changed.

```text
Table with 0 indexes: UPDATE → 1 row written  ($1/M)
Table with 1 index:   UPDATE → 2 rows written ($2/M)
Table with 3 indexes: UPDATE → 4 rows written ($4/M)  ← was the old agents table
```

### DO-local SQLite doesn't need indexes for reads

Unlike D1 (network hop, shared database), DO SQLite is **in-process memory**.
A full table scan of 30,000 rows takes <1ms. The read cost of scanning
30K rows is $0.00003. The write penalty of one unnecessary index across
100K agents/day is $2.40/day.

### Rule: Zero indexes on hot-path tables

The `agents` table is written on every state-changing message. It must
have **zero indexes**. All aggregate queries (`getStats`, `getCohortBreakdown`,
`computeMetricsSql`) are full-table scans anyway — indexes don't help them.

If you ever need an index (e.g., a new query pattern on a cold-path table),
calculate the cost:

```text
Index cost/month = (writes/month) × ($/M) × (number of indexes)
Index savings/month = (reads saved/month) × ($0.001/M)

Example — 100K agents, 1 write/hr/agent:
  Writes/month: 72M
  One index adds: 72M × $1/M = $72/month
  Reads saved (if any): ~0 (full scans dominate)
  Net: -$72/month per index
```

### The pending_devices table can have indexes

It's written on the **connect** path (cold, once per connection lifetime),
not the message hot path. Its 2 indexes cost negligibly.

## Write Tiers

Not all messages need the same persistence. Classify every message:

### Tier 0 — No-op heartbeat (0 writes)

The agent sent a heartbeat with no state changes. ~90% of all messages.

- `sequence_num` and `last_seen_at` are tracked in the WebSocket attachment
  (free — survives hibernation via `serializeAttachment`)
- If the DO evicts, we lose sequence_num → agent sends seq=0 on reconnect →
  server requests `ReportFullState` → agent sends everything → we persist.
  This is exactly what the sequence gap handler already does.
- `last_seen_at` for liveness is redundant: `webSocketClose()` fires
  instantly on disconnect. The stale sweep is only for silent deaths, and
  checking `ctx.getWebSockets()` is authoritative.

### Tier 1 — Field change (1 write)

Health changed, config applied, capabilities updated. ~9% of messages.

- `processFrame` tracks which fields changed via `dirtyFields: Set<string>`.
- `updateAgentPartial` builds a dynamic `UPDATE ... SET` with only dirty columns,
  always piggybacking `sequence_num` and `last_seen_at` at zero marginal cost.
- No JSON.stringify for untouched `component_health_map` or `available_components`.
- config_rejected sets `shouldPersist=true` but adds NO dirty fields — it's an
  event-only transition that skips SQL entirely.

### Tier 2 — Full state (1-2 writes)

Reconnect hello, full state report, effective config change. ~1% of messages.

- Full UPSERT with all 16 columns + JSON.stringify for component maps.
- INSERT OR IGNORE into config_snapshots if new effective config body.
- `forceFullPersist` flag in config-do.ts ensures first message after connect
  always uses full UPSERT, since config-do mutates `generation`, `connected_at`,
  and `status` outside processFrame (they won't appear in dirtyFields).
- This is unavoidable and acceptable — it's rare.

## Rate Limiting

### Don't rate-limit inside the DO

The DO's internal per-message rate limiter (`checkRateLimit`) was an
unconditional SQLite UPDATE on every single message — the most expensive
operation we do, running even for well-behaved agents.

By the time the rate limiter runs, we've already paid: the DO is awake,
JS is executing, the message is deserialized. Closing the socket triggers
a reconnect, which is MORE expensive.

The DO is single-threaded (~500-1000 msg/sec ceiling). That IS the rate
limit. A misbehaving agent can't overwhelm it — it can only starve
siblings of attention.

### Rate limit at the edge

Use Cloudflare WAF Rate Limiting Rules for connection-level abuse:

- Runs at the edge before the DO is even woken
- Free on all CF plans (1-5 rules depending on plan)
- Applies to HTTP requests (WebSocket upgrades), not individual WS messages

## Compound Reads

### Safe: PK lookups across tables

```sql
-- 2 billed row reads (both PK lookups), regardless of table size
SELECT a.*, d.desired_config_hash, d.desired_config_bytes
FROM agents a, do_config d
WHERE a.instance_uid = ? AND d.id = 1
```

The `do_config` table is always 1 row (singleton, `CHECK (id = 1)`).
The `agents` lookup is by PRIMARY KEY. This is O(1) + O(1), not a cross join.

### Dangerous: Unbounded scans

```sql
-- BAD: 30K billed row reads
SELECT * FROM agents WHERE status = 'connected'

-- OK: This is fine for aggregate metrics (alarm path, ~1/min during activity)
-- because reads cost $0.001/M and it only fires on state changes.
SELECT COUNT(*), SUM(CASE WHEN healthy = 1 THEN 1 ELSE 0 END) FROM agents
```

## WebSocket Attachment as Free Storage

`ws.serializeAttachment()` / `ws.deserializeAttachment()` is JSON
serialization managed by the CF runtime. It:

- Survives hibernation (persisted alongside the WebSocket)
- Costs zero billed row reads/writes
- Is per-connection (each WebSocket has its own attachment)

Use it for per-connection ephemeral state:

- `sequence_num` (only needs to survive the connection lifetime)
- `last_seen_at` (redundant with `webSocketClose()` for disconnect detection)
- `capabilities` (agent-reported capabilities bitmask)

Do NOT use it as a substitute for SQLite for state that must survive
connection drops (agent health, config hash, generation).

## Cost Calculator

```text
Monthly cost = (messages/month × writes_per_message × (1 + num_indexes) × $1/M)
             + (messages/month × reads_per_message × $0.001/M)
             + (messages/month ÷ 20 × $0.15/M)  # WS messages billed 20:1

Example: 10K agents, 1 heartbeat/hr, 0 indexes, tier-0 (0 writes):
  Messages/month: 10K × 24 × 30 = 7.2M
  Writes: 0 (no-op heartbeats)
  Reads: 7.2M × 2 = 14.4M → $0.01
  Requests: 7.2M ÷ 20 = 360K → $0.05
  Total: $0.06/month

Example: 10K agents, 1 heartbeat/hr, 3 indexes, current (6 writes):
  Writes: 7.2M × 6 = 43.2M → $43.20
  Reads: 7.2M × 3 = 21.6M → $0.02
  Requests: 360K → $0.05
  Total: $43.27/month (720× more expensive)
```

## Command Response Fields

The command handler (`command-handler.ts`) exposes admin actions via
`POST /command/*` endpoints. Each returns JSON with observability counters:

| Command            | Endpoint                      | Response fields                                     |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| Set desired config | `/command/set-desired-config` | `pushed`, `failed`, `skipped_no_cap`, `config_hash` |
| Disconnect all     | `/command/disconnect-all`     | `disconnect_requested`, `failed`                    |
| Restart            | `/command/restart`            | `restarted`, `failed`, `skipped_no_cap`             |
| Sweep stale        | `/command/sweep`              | `swept`, `active_websockets`, `duration_ms`         |

- `failed` — send/close threw (socket already closing, buffer full)
- `skipped_no_cap` — agent lacks the required capability (e.g., `AcceptsRemoteConfig` or `AcceptsRestartCommand`)
- Broadcast loop yields every 1,000 sends to allow GC and buffer flushing

## File Map

| File                         | Hot path?  | What to watch                                          |
| ---------------------------- | ---------- | ------------------------------------------------------ |
| `agent-state-repo.ts`        | YES        | Every SQL statement. Count writes. Check for indexes.  |
| `config-do.ts`               | YES        | `webSocketMessage()` — trace every repo call.          |
| `command-handler.ts`         | NO (admin) | Broadcast is O(n) but zero SQL writes per agent.       |
| `query-handler.ts`           | NO (admin) | Full scans are fine here — reads are cheap.            |
| `constants.ts`               | —          | `ALARM_TICK_MS`, heartbeat intervals.                  |
| `ws-attachment.ts`           | YES        | Free storage — use for ephemeral per-connection state. |
| `sqlite-agent-state-repo.ts` | YES        | Thin wrapper — changes here ripple everywhere.         |
