# Live Collector Telemetry

## The Goal

When an operator opens a config or collector page in the o11yFleet portal, the collectors in that view start streaming their own internal telemetry (metrics first, logs and traces later). The operator sees live flows — receivers accepting, processors filtering, exporters sending. When they close the tab, the stream stops.

## Why OpAMP `own_metrics` Makes This Possible

OpAMP has a side channel called `own_metrics` that is separate from the collector's data pipeline. When our control plane sends a `ServerToAgent` message containing `ConnectionSettingsOffers.own_metrics`, the OpAMP supervisor opens a new OTLP connection to the endpoint we specify and streams the collector's internal telemetry. We can turn this on, off, or re-point it at any time by sending a new offer over the existing WebSocket. The collector's pipeline never restarts.

We do not modify or recompile the collector. Stock `otelcol-contrib` plus the stock OpAMP supervisor already emits everything we need.

## Architecture

```
Browser UI (portal)
  │
  │ WebSocket: "subscribe to config X"
  ▼
┌─────────────────────────────────────────┐
│  Config Durable Object (existing)        │
│  - Holds OpAMP WebSockets to collectors │
│  - Tracks viewer refcount              │
│  - Sends own_metrics offers via OpAMP  │
│  - Holds SQLite: metric_points table   │
│  - Pushes live updates to browser WSs  │
└────────┬────────────────────────────────┘
         │ OpAMP ServerToAgent:
         │ ConnectionSettingsOffers.own_metrics
         ▼
    Collector Supervisor
         │
         │ OTLP/HTTP POST (metrics)
         ▼
┌──────────────────────────┐
│  Ingest Worker            │
│  - Verifies bearer token │
│  - Extracts tenant_id,   │
│    collector_id from JWT │
│  - Forwards to tenant DO │
└──────────────────────────┘
```

## End-to-End Flow

1. Portal frontend opens a WebSocket to `wss://api.o11yfleet.com/v1/live/config/{configId}`.
2. Config DO verifies the session, records the viewer, increments refcount.
3. Because refcount went from 0→1, the DO mints short-lived JWTs and sends `ConnectionSettingsOffers.own_metrics` over the already-open OpAMP WebSockets.
4. Supervisors receive the offer, open OTLP connections, begin streaming internal metrics.
5. Ingest Worker receives OTLP/HTTP POSTs, verifies the JWT, forwards to the Config DO.
6. Config DO normalizes OTLP protobuf into SQLite rows and pushes updates over the portal WebSocket.
7. User closes tab. Refcount hits zero. DO sends empty `own_metrics` offers. Streams stop.

## Invariants

1. **`tenant_id` is never trusted from a client.** Always derived from a verified JWT.
2. **Collectors never stream unless a viewer session requires it.** No code path triggers ingest outside the refcount.
3. **The collector is never modified.** Stock `otelcol-contrib` + stock supervisor must always be sufficient.
4. **No OpAMP change causes a collector pipeline reload.** `own_metrics` offers live in the supervisor's connection layer.
5. **Per-tenant DO isolation is the security boundary.** No shared state across tenants.

## Phase Map

| Phase | Description                                                              |
| ----- | ------------------------------------------------------------------------ |
| 1     | OpAMP offer plumbing — enable/disable own_metrics, debug ingest endpoint |
| 2     | Ingest Worker with JWT auth                                              |
| 3     | SQLite schema in Config DO, ingest handler                               |
| 4     | OTLP normalization — parse protobuf, extract key metrics                 |
| 5     | Viewer refcounting and offer lifecycle                                   |
| 6     | Portal WebSocket for live updates                                        |
| 7     | Token rotation alarm                                                     |
| 8     | TTL cleanup alarm                                                        |
| 9     | Flow diagram UI                                                          |
| 10    | E2E testing against real otelcol-contrib                                 |
