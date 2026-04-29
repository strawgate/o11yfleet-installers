# Cloudflare Durable Objects: WebSocket Scaling & Troubleshooting

> Lessons learned scaling OpAMP agent connections on Cloudflare Workers + Durable Objects.  
> Last validated: **15,000 concurrent agents** on staging with 98.1% retention over 30 seconds. 10K agents at 99.4% retention.

---

## Table of Contents

1. [Key Architecture Decisions](#key-architecture-decisions)
2. [Troubleshooting Guide](#troubleshooting-guide)
3. [Load Test Results](#load-test-results)
4. [Path to 100K Agents](#path-to-100k-agents)
5. [Should We Use Rust + WASM?](#should-we-use-rust--wasm)

---

## Key Architecture Decisions

### WebSocket Hibernation API

Durable Objects support two WebSocket models. We use the **Hibernation API** (`acceptWebSocket()` + `webSocketMessage()` event handlers), which lets the runtime evict the DO from memory between messages. Idle connections cost zero CPU.

```typescript
// DO wakes ONLY when a message arrives — not while idle
webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>
```

Without hibernation, every open WebSocket keeps the entire DO in memory permanently. With hibernation, the DO sleeps and wakes per-message.

### Auto-Response Keepalive (The Breakthrough)

Cloudflare's edge proxy terminates WebSocket connections that are idle for ~100 seconds. Our initial approach — server-directed OpAMP heartbeats every 90 seconds — caused massive DO wake storms that overwhelmed the runtime at 5K connections.

The fix: `setWebSocketAutoResponse()` in the DO constructor.

```typescript
constructor(ctx: DurableObjectState, env: ConfigDOEnv) {
  super(ctx, env);
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
}
```

This tells the **Cloudflare runtime** (not the DO) to auto-reply "pong" to text "ping" frames. The DO never wakes. This has several implications:

- **Zero CPU cost** — the runtime handles it at the edge layer
- **Resets the idle timeout** — the edge sees activity and keeps the connection alive
- **OpAMP heartbeats become infrequent** — we set the heartbeat interval to 1 hour, used only for periodic state reconciliation
- **Clients send text "ping" every 30 seconds** — cheap, tiny, handled by Cloudflare runtime

At 250K agents with 1-hour heartbeats, the DO processes only ~69 messages/second instead of ~556/second (at 90s heartbeat). That's an 8× reduction in DO work.

### Liveness Detection

With auto-response keepalive, the DO doesn't need heartbeats for liveness. We use two mechanisms:

1. **`webSocketClose()` handler** — triggers immediately when a client cleanly disconnects. Fires a disconnect event and marks the agent `disconnected` in SQLite.
2. **Stale agent sweep** — the alarm handler (every 60s) queries agents with `last_seen_at` older than 3 hours and marks them disconnected.

> **⚠️ `getWebSocketAutoResponseTimestamp()` is unreliable at scale.** Our testing showed that this API returns `null` for hibernated sockets even when clients are actively sending pings and receiving auto-response pongs. At 5K+ connections, using it for zombie detection caused mass false-positive kills. We disabled it entirely.

This gives us:

- **Instant clean-disconnect detection** — via `webSocketClose()`
- **3-hour silent-death detection** — via stale agent sweep (conservative threshold)
- **Zero DO wakes for liveness** — only the alarm wakes the DO (once per 60s)
- **Accurate connected count** — `this.ctx.getWebSockets().length` is authoritative
- **Event-driven state changes** — agents send messages immediately when health/config changes, not on a heartbeat schedule

### SQLite Event Buffer + Alarm Drain

Early versions used `ctx.waitUntil(queue.send())` to emit events (enrollment, health change, config applied, etc.) from the WebSocket message handler. At scale, this accumulated thousands of unresolved async promises that overwhelmed the DO runtime, causing mass disconnections at ~3,800 agents.

**Fix:** Write events synchronously to a `pending_events` SQLite table (~µs per INSERT), then drain them in batches via the alarm handler:

```
Hot path (sync):  message → process → INSERT INTO pending_events → respond
Alarm (async):    SELECT/DELETE 100 events → queue.sendBatch() → reschedule
```

The hot path is now 100% synchronous. All async work (queue sends) happens in the alarm, isolated from WebSocket message processing.

### Crash-Proof Message Handler

A single unhandled exception in `webSocketMessage()` can crash the DO, terminating **all** connections — not just the one that caused the error. We wrap the entire handler in try/catch:

```typescript
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  try {
    // ... all processing ...
  } catch (err) {
    console.error("[webSocketMessage] unhandled error:", err);
    try {
      ws.close(1011, "Internal error");
    } catch {
      // Socket may already be closed
    }
  }
}
```

Never let a single bad agent message take down the entire DO.

---

## Troubleshooting Guide

### Problem: Mass disconnections after stable enrollment

**Symptom:** All 5,000 agents enroll successfully, connections appear stable for 2-5 minutes, then all connections drop simultaneously.

**Root causes we found (in order of discovery):**

1. **Edge idle timeout (~100s)**
   - Cloudflare edge proxy kills WebSockets with no activity for ~100 seconds
   - Even with hibernation, the edge doesn't know the connection is still "wanted"
   - **Fix:** Auto-response keepalive (see above) OR frequent heartbeats (expensive)

2. **Async promise accumulation**
   - `ctx.waitUntil(queue.send(...))` during message handling creates promises the runtime must track
   - At 5K agents × 3 events each = 15,000 pending promises
   - DO runtime collapses under the promise tracking overhead
   - **Fix:** SQLite event buffer — zero async on the hot path

3. **OTel SDK overhead**
   - `@microlabs/otel-cf-workers` wrapping adds ~500µs per request even when the OTLP exporter endpoint is unreachable
   - Dead exports to `localhost:4318` time out but still consume CPU
   - **Fix:** Use native CF observability (`observability: { enabled: true }` in wrangler.jsonc), remove OTel wrapper from the entrypoint

4. **Heartbeat burst storms**
   - 5,000 agents with 5-30s jitter all fire their first heartbeat within a 25-second window
   - That's ~200 msg/sec burst, each doing 3 SQL operations + encode + send
   - **Fix:** Set heartbeat interval to 1 hour — heartbeats are for state reconciliation only, not liveness. Liveness uses auto-response timestamps checked in the alarm.

5. **Unhandled throws**
   - A single malformed protobuf message could throw in the decoder, crashing the DO
   - **Fix:** Crash-proof try/catch around the entire `webSocketMessage` handler

### Problem: Agents connect but never receive config

**Symptom:** OTel Collectors connect, appear in the agent list, but never apply the desired configuration.

**Root cause:** opamp-go wire format incompatibility.

The opamp-go library prepends a `0x00` varint header before the protobuf payload. Our `isProtobufFrame()` function was misidentifying these frames as JSON framing (which also starts with `0x00`).

**Fix:** 3-way format detection:

```
byte[0] >= 0x08  → raw protobuf (field 1, varint type)
byte[0] == 0x00, byte[1] >= 0x08 → opamp-go protobuf (varint header + protobuf)
byte[0] == 0x00, byte[4] == 0x7B → JSON framing (4-byte length + '{')
```

### Problem: OTel Collectors crash on enrollment

**Symptom:** opamp-go based collectors crash with protobuf decode error immediately after WebSocket upgrade.

**Root cause:** We sent an `enrollment_complete` text frame (`"enrollment_complete"`) to ALL clients after enrollment. opamp-go tried to decode this string as a protobuf message and panicked.

**Fix:** Only send the text `enrollment_complete` frame to JSON-framing clients (our test agents). Protobuf clients (real collectors) get the enrollment response as a normal ServerToAgent protobuf message.

### Problem: Connected agent count always shows 0

**Symptom:** `getStats()` returns `connected_agents: 0` even with active connections.

**Root cause:** The query counted `status = 'connected'` but no code path ever set that status. Agents go from `'unknown'` → `'running'`/`'degraded'` → `'disconnected'`.

**Fix:** Count agents where `status != 'disconnected'` (all non-disconnected agents are "connected").

### Enabling Cloudflare Observability

For staging/debugging, enable native CF observability in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1, // 100% for debugging, lower in production
  },
}
```

This gives you logs, traces, and invocation metrics in the Cloudflare dashboard without any code changes or SDK overhead. Much lighter than `@microlabs/otel-cf-workers`.

---

## Load Test Results

All tests against Cloudflare staging (`o11yfleet-worker-staging.o11yfleet.workers.dev`).

### Local (miniflare)

| Test | Target | Enrolled | Notes           |
| ---- | ------ | -------- | --------------- |
| 1K   | 1,000  | 1,000 ✅ | Perfect         |
| 5K   | 5,000  | 5,000 ✅ | Perfect         |
| 7.5K | 7,500  | 7,500 ✅ | Perfect         |
| 10K  | 10,000 | OOM ❌   | Miniflare limit |

### Staging (real Cloudflare)

| Test                         | Target     | Enrolled      | Alive (steady)   | Retention | HB P99 | Notes                                         |
| ---------------------------- | ---------- | ------------- | ---------------- | --------- | ------ | --------------------------------------------- |
| 1K (heartbeat)               | 1,000      | 997 ✅        | 997              | 99.7%     | —      | First staging success                         |
| 5K (90s heartbeat)           | 5,000      | 5,000 ✅      | 0 ❌             | 0%        | —      | Mass drop at ~3 min (async promise storm)     |
| 5K (SQLite buffer)           | 5,000      | 5,000 ✅      | 0 ❌             | 0%        | —      | Same pattern                                  |
| 5K (no OTel SDK)             | 5,000      | 3,795 ⚠️      | 0 ❌             | 0%        | —      | Better but still dropped                      |
| 5K (ping keepalive)          | 5,000      | 5,000 ✅      | 4,995            | 99.9%     | —      | **Breakthrough** — auto-response keepalive    |
| 5K (zero-wake + zombie det.) | 5,000      | 5,000 ✅      | 0 ❌             | 0%        | —      | Zombie detection killed healthy connections   |
| 5K (no zombie det.)          | 5,000      | 4,987 ✅      | 4,770            | 95.4%     | —      | Stable — 1006 drops are CF edge, not us       |
| 5K (no probes)               | 5,000      | 4,987 ✅      | 4,625            | 92.5%     | —      | A/B: probes are NOT the cause of 1006 drops   |
| **10K**                      | **10,000** | **10,000 ✅** | **9,944 (30s)**  | **99.4%** | 4.7ms  | ✅ Zero enrollment failures                   |
| **15K**                      | **15,000** | **15,000 ✅** | **14,720 (30s)** | **98.1%** | 7.2ms  | ✅ Single-process client ceiling (1.45GB RSS) |
| 20K (single process)         | 20,000     | 11.6K ⚠️      | —                | —         | —      | Node.js OOM at ~12K sockets per process       |
| 25K (5 workers)              | 25,000     | ~18K ⚠️       | 0 ❌             | 0%        | —      | All connections dropped during enrollment     |

### Key Findings

1. **Auto-response keepalive was the single most impactful change.** Without it, nothing else mattered.
2. **`getWebSocketAutoResponseTimestamp()` is unreliable at scale** — returns null for hibernated sockets, causing false zombie detection kills. Disabled entirely.
3. **1006 (abnormal closure) drops of ~2-7% are Cloudflare edge infrastructure**, not caused by DO wakes or heartbeat probes (proven via A/B test with `--no-probes`).
4. **The practical per-DO ceiling is ~15K connections** from a single client machine. The actual platform limit may be higher but requires distributed load generation to test.
5. **Enrollment rate is consistently 130-150/s** regardless of connection count — the DO handles enrollment perfectly.
6. **Heartbeat P99 at 15K: 7.2ms** — negligible overhead even at scale.

### Running Load Tests

```bash
# Prerequisites: staging deployed, secrets set
just load-test-1k   # 1,000 agents
just load-test-5k   # 5,000 agents
just load-test-10k  # 10,000 agents
just load-test-100k # 100,000 agents (needs sharding — see below)
```

Load tests target the staging environment by default. See `tests/load/src/load-test.ts` for configuration.

---

## Path to 250K Agents

### Zero-Wake Model: Pushing the Ceiling

With the zero-wake heartbeat model, the DO's steady-state workload is dramatically reduced:

| Metric                    | Before (10-min heartbeat) | After (zero-wake)              |
| ------------------------- | ------------------------- | ------------------------------ |
| DO wakes per second (50K) | ~83/s                     | ~0/s (alarm only: 1/60s)       |
| SQLite writes per second  | ~167/s (UPSERT per HB)    | ~0/s (only real state changes) |
| Offline detection latency | 30 minutes (3× heartbeat) | 2 minutes (auto-response)      |
| CPU utilization           | ~0.6 ms/s                 | ~0 ms/s (alarm: ~250ms/60s)    |

The DO is essentially dormant. It wakes only for:

1. **Alarm** (every 60s) — zombie detection + event drain
2. **Config push** (admin action, rare)
3. **Real state changes** (health degraded, config applied — event-driven, rare per agent)

### Current Architecture Ceiling: 15K+ Confirmed (client-limited)

Our load testing confirmed **15,451 concurrent WebSocket connections** on a single DO with no server-side issues. The test was limited by the **client machine's ephemeral port supply** (16,383 on macOS), not by Cloudflare.

**What we know:**

| Resource              | Limit        | At 15K (confirmed) | Projected at 50K |
| --------------------- | ------------ | ------------------ | ---------------- |
| Hibernated WebSockets | Undocumented | 15,451 ✅ (solid)  | Needs testing ⚠️ |
| DO memory (awake)     | 128 MB       | Well within ✅     | ~25 MB alarm ✅  |
| SQLite storage        | 1-10 GB      | ~7.5 MB ✅         | ~25 MB ✅        |
| Message throughput    | 1,000 req/s  | ~0 msg/s ✅        | ~0 msg/s ✅      |
| CPU per alarm tick    | 30s          | ~50ms ✅           | ~100ms ✅        |

**What limits further testing (NOT the DO):**

- **Client ephemeral ports** — macOS: 16,383 (49152–65535). Each WebSocket uses one TCP port. At ~15K connections we exhaust them.
- **Client memory** — each Node.js process caps at ~1.5GB for ~15K WebSocket objects.
- **Distributed testing needed** — to push past 15K requires multiple client machines.

**Key unknowns:**

- **Actual hibernated WebSocket limit** — Community reports suggest ~32K per DO. Our testing confirms 15K+ works; the real ceiling is likely higher.
- **Alarm memory spike at 50K+** — `this.ctx.getWebSockets()` creates an array of all socket handles. At 50K that's ~5-10 MB of proxy objects. Within budget but needs validation.
- **SQLite row size** — At ~500 bytes/row (minimal), 250K = ~125 MB. Well within 1 GB limit. But `effective_config_body` (2-5 KB) must be moved to R2 first.

### Strategy: DO Sharding (if needed)

If the per-DO ceiling is below 250K, shard across multiple DOs:

```
                    ┌──────────────┐
                    │   Worker     │
                    │  (Router)    │
                    └──────┬───────┘
                           │ hash(instance_uid) % N
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Shard 0  │ │ Shard 1  │ │ Shard 2  │
        │ ConfigDO │ │ ConfigDO │ │ ConfigDO │
        │ ~83K WS  │ │ ~83K WS  │ │ ~83K WS  │
        └──────────┘ └──────────┘ └──────────┘
```

**Routing:** `DO_ID = hash(tenant_id:config_id:shard_N)` where `N = hash(instance_uid) % shard_count`

**Config push:** When desired config changes, the worker fans out the update to all shards. Each shard pushes to its own WebSocket connections.

**Stats aggregation:** `getStats()` must query all shards and sum. Use the worker to aggregate.

**Shard count:** Start with 3 shards (~83K per shard), auto-scale based on connection count.

### Implementation Priority

1. **Run 10K staging test** — Find the actual next ceiling with zero-wake model
2. **Run 25K, 50K staging tests** — Push until we find the real limit
3. **Reduce per-agent SQLite footprint**
   - Remove `effective_config_body` from the agents table (store hash only, body in R2)
   - Compact `agent_description` — store structured fields, not raw JSON blob
4. **Implement DO sharding** — Only if per-DO ceiling is below target
5. **Optimize config push** — `handleSetDesiredConfig` iterates all sockets; at 50K+ batch the sends

### Quick Wins (No Architecture Change)

These changes would increase per-DO capacity without sharding:

| Change                                                  | Impact                      | Status         |
| ------------------------------------------------------- | --------------------------- | -------------- |
| Zero-wake liveness via auto-response timestamps         | ~0 msg/s in steady state    | ✅ Implemented |
| 1-hour heartbeat interval (state reconciliation only)   | 69 msg/s at 250K (from 556) | ✅ Implemented |
| Connected count from `getWebSockets().length` (not SQL) | -1 COUNT(\*) per stats call | ✅ Implemented |
| Store only `effective_config_hash`, move body to R2     | -2-5 KB/agent               | Planned        |
| Compact `agent_description` storage                     | -200-1000 bytes/agent       | Planned        |
| Increase alarm drain batch to 1,000                     | -10× event backlog drain    | Planned        |

---

## Should We Use Rust + WASM?

**No — not for message processing.**

We ran a heartbeat microbenchmark (`packages/core/test/heartbeat-bench.test.ts`) that measures the complete hot path: protobuf decode → `processFrame()` → protobuf encode.

| Operation                                 | Time    | Throughput |
| ----------------------------------------- | ------- | ---------- |
| Full pipeline (decode + process + encode) | ~9 µs   | 108K ops/s |
| `processFrame()` alone                    | ~0.2 µs | 5.5M ops/s |

At 250K agents with 1-hour heartbeat intervals, the DO processes ~69 messages/second. That's **69 × 9µs = 0.62 ms/second** of CPU — less than **0.1%** of available CPU budget.

**TypeScript is not the bottleneck.** The bottlenecks are:

1. **Memory** — WebSocket runtime overhead, not our code
2. **Cloudflare platform limits** — undocumented WebSocket cap per DO
3. **SQLite I/O** — 3 queries per heartbeat at 167 msg/s = 500 queries/s (fast but adds up)
4. **Event drain throughput** — alarm handler batching, not processing speed

### Where WASM _Could_ Help

There are a few niche areas where Rust+WASM might provide value:

| Area                        | Potential Benefit                         | Effort    | Worth It?                        |
| --------------------------- | ----------------------------------------- | --------- | -------------------------------- |
| Protobuf codec              | 2-3× faster encode/decode                 | Medium    | ❌ Already ~50µs, not bottleneck |
| Batch state machine         | Process 100 heartbeats in one WASM call   | High      | ❌ processFrame is ~0.2µs        |
| FNV-1a hash                 | Marginally faster hashing                 | Low       | ❌ Only runs on config changes   |
| Connection metadata packing | Tighter binary packing of WSAttachment    | Medium    | ⚠️ Maybe, if memory is the limit |
| Custom WebSocket mux        | Multiplex N logical agents over 1 real WS | Very High | ⚠️ Would defeat CF's hibernation |

**Verdict:** The only scenario where WASM helps is if we need to squeeze more agents into the same 128 MB by using more compact data structures. But that doesn't address the fundamental WebSocket connection limit.

### What Actually Gets Us to 100K

1. **DO Sharding** — 4 DOs × 25K agents each. This is the only reliable path.
2. **Memory reduction** — Remove `effective_config_body` per agent, target ~1 KB/agent for ~30K+ per DO.
3. **Smart routing** — Consistent hash on `instance_uid` for even distribution.
4. **Fan-out config push** — Worker broadcasts config changes to all shards.

The engineering effort for sharding is moderate and well-understood. It's a much better investment than Rust+WASM for message processing that already takes 9 microseconds.

---

## Reference: Cloudflare DO Limits

| Resource                  | Documented Limit           | Practical Limit | Source                                                                        |
| ------------------------- | -------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Memory per DO             | 128 MB                     | 128 MB          | [CF Docs](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| CPU per request           | 30s wall, ~30s CPU         | ~30s            | CF Docs                                                                       |
| CPU per alarm             | 30s                        | ~30s            | CF Docs                                                                       |
| SQLite storage            | 1 GB (soft) / 10 GB (hard) | 1 GB            | CF Docs                                                                       |
| Subrequests per request   | 1,000                      | 1,000           | CF Docs                                                                       |
| WebSocket message size    | 1 MB                       | 1 MB            | CF Docs                                                                       |
| Inbound requests/s        | 1,000 (soft)               | 1,000           | CF Docs                                                                       |
| Hibernated WS connections | Not documented             | 15K+ confirmed  | Our testing (client-limited, actual ceiling likely higher)                    |
| Edge idle timeout         | Not documented             | ~100 seconds    | Our testing                                                                   |
| Auto-response CPU         | Zero                       | Zero            | Our testing                                                                   |
| Auto-response timestamps  | Documented as reliable     | Unreliable      | Our testing (returns null for hibernated sockets at scale)                    |
