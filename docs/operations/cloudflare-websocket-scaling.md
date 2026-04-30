# Cloudflare WebSocket Scaling

Operational notes from scaling OpAMP connections on Cloudflare Workers and
Durable Objects. Last validated result: 15,000 concurrent staging agents with
98.1% retention over 30 seconds; 10,000 agents reached 99.4% retention.

## Decisions That Matter

### Use WebSocket Hibernation

Config DOs use the Durable Object Hibernation API:

```typescript
ctx.acceptWebSocket(ws);
webSocketMessage(ws, message);
```

Idle collectors should not keep the DO in memory. Avoid APIs or timers that wake
the DO per idle connection.

### Use Runtime Auto-Response Keepalive

Cloudflare edge proxies terminate idle WebSockets after roughly 100 seconds. DO
heartbeats every 90 seconds caused wake storms at scale. The fix is runtime-level
auto-response:

```typescript
ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
```

Clients send text `ping` about every 30 seconds. Cloudflare responds with `pong`
without waking the DO. OpAMP heartbeats can stay infrequent and serve state
reconciliation, not liveness.

### Keep The Message Hot Path Synchronous

Do not send Queue events from `webSocketMessage()` with unresolved async work.
The stable model is:

```text
message -> process -> INSERT pending_events -> respond
alarm -> SELECT/DELETE batch -> queue.sendBatch()
```

This prevents promise accumulation from disconnecting large fleets.

### Never Let One Bad Frame Crash The DO

Wrap `webSocketMessage()` in a top-level try/catch and close only the offending
socket on unrecoverable decode/processing errors. A thrown exception can terminate
the DO instance and drop every connected collector.

## Troubleshooting

| Symptom                                        | Likely cause                                                                       | Fix                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Mass disconnects after 2-5 minutes             | Edge idle timeout or heartbeat wake storm                                          | Use auto-response keepalive; keep OpAMP heartbeats infrequent             |
| Mass disconnects during event-heavy enrollment | Async Queue promises in message handler                                            | Buffer events in DO SQLite and drain by alarm                             |
| Agents connect but never receive config        | opamp-go frame prefix misdetected as JSON framing                                  | Keep 3-way frame detection: raw protobuf, opamp-go protobuf, JSON framing |
| opamp-go collectors crash on enrollment        | Text `enrollment_complete` sent to protobuf clients                                | Send text completion only to JSON-framing test clients                    |
| Connected count is zero                        | Counting SQL status instead of active sockets                                      | Use `ctx.getWebSockets().length` for live connected count                 |
| False zombie cleanup at scale                  | `getWebSocketAutoResponseTimestamp()` returned null for healthy hibernated sockets | Do not use it as the kill condition without fresh validation              |

## Observability

Prefer Cloudflare native observability in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
  },
}
```

The previous OTel Worker wrapper added overhead and noisy failed exports when
the OTLP endpoint was unavailable.

## Load-Test Evidence

| Target                          | Result                    | Notes                          |
| ------------------------------- | ------------------------- | ------------------------------ |
| 1K local                        | 1,000 enrolled            | Perfect in miniflare           |
| 5K local                        | 5,000 enrolled            | Perfect in miniflare           |
| 10K local                       | OOM                       | Local miniflare/client limit   |
| 5K staging before auto-response | 0 retained                | Repeated mass drops            |
| 5K staging after auto-response  | 4,995 retained            | Breakthrough                   |
| 10K staging                     | 9,944 retained after 30s  | 99.4%, heartbeat P99 4.7ms     |
| 15K staging                     | 14,720 retained after 30s | 98.1%, client RSS/port ceiling |

Run staging load tests with:

```bash
just load-test-1k
just load-test-5k
just load-test-10k
```

## Scaling Direction

The current single-DO design is confirmed at 15K+ concurrent WebSockets. To push
toward 100K+, the likely path is sharding by `instance_uid`:

```text
Worker router
  -> hash(tenant_id:config_id:shard_N)
  -> Config DO shard 0..N
```

Sharding implications:

- config push fans out to every shard
- stats aggregate across shards
- routing must be stable for reconnect claims
- shard count should increase only after measured per-DO ceilings justify it

Before sharding, reduce per-agent storage:

- store effective config body in R2, not DO SQLite
- compact agent description storage
- increase event-drain batch size where safe
- batch config-push sends for very large socket sets

## Rust/WASM

Do not move message processing to Rust/WASM for speed. The TypeScript hot path is
already fast enough for the current heartbeat model; platform limits, WebSocket
memory, SQLite footprint, and event drain throughput are the real constraints.
