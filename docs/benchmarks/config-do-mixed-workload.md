# Config DO Mixed-Workload Load Test (Experiment Harness)

This harness is for issue #233 and related load-scaling work. It is intentionally **experimental** and does **not** implement production sharding.

## What this scenario exercises

- high concurrent agent connections,
- periodic rollout pushes,
- periodic `/agents` list reads,
- periodic `/stats` reads,
- reconnect-storm behavior,
- Worker/DO/API failure signals.

## Command

```bash
pnpm --filter @o11yfleet/load-test mixed -- \
  --url=https://<worker-host> \
  --api-key=<api-key> \
  --agents=2000 \
  --duration=600 \
  --rollout-every=30 \
  --list-rps=5 \
  --stats-rps=5 \
  --reconnect-pct=10 \
  --concurrency=100 \
  --output=./artifacts/mixed-2k.json
```

## Environment variables / secrets

- `FP_URL` (optional if `--url` used)
- `FP_API_KEY` (optional if `--api-key` used; required for every run)
- Optional parameter mirrors:
  - `FP_AGENTS`
  - `FP_DURATION_SEC`
  - `FP_ROLLOUT_EVERY_SEC`
  - `FP_LIST_RPS`
  - `FP_STATS_RPS`
  - `FP_RECONNECT_PCT`
  - `FP_CONCURRENCY`
  - `FP_OUTPUT`
  - `FP_OPERATION_TIMEOUT_MS`

## Parameters

- `--agents`: target agent count.
- `--duration`: test duration seconds.
- `--rollout-every`: seconds between rollout requests.
- `--list-rps`: target request rate for `/agents` reads.
- `--stats-rps`: target request rate for `/stats` reads.
- `--reconnect-pct`: total reconnect storm volume (% of connected agents, spread across run).
- `--concurrency`: enrollment concurrency.
- `--operation-timeout-ms`: per-request budget applied to every harness API
  call — enrollment, reconnect, rollout, list, stats, and cleanup. A long
  timeout here caps the total time any single backend call can stall the
  harness.
- `--output`: output JSON file path.

## Output format

JSON file includes:

- `config`: resolved run parameters.
- `counters`: connect attempts/success/failure and error map.
- `metrics.connected_agents_over_time`: timeline samples.
- `metrics.connect_latency`: initial enrollment connect latency summary.
- `metrics.rollout`: latency summary.
- `metrics.list_latency`: API list latency summary.
- `metrics.stats_latency`: API stats latency summary.
- `metrics.reconnect_latency`: reconnect latency summary.
- `metrics.reconnect_success` / `metrics.reconnect_failed`.
- `notes.backlog_proxy`: interpretation guidance for detecting delayed recovery.

## Suggested runs

### 2k smoke

```bash
pnpm --filter @o11yfleet/load-test mixed -- --agents=2000 --duration=300 --rollout-every=30 --list-rps=2 --stats-rps=2 --reconnect-pct=5 --concurrency=100 --output=./artifacts/mixed-2k.json
```

### 10k production gate

```bash
pnpm --filter @o11yfleet/load-test mixed -- --agents=10000 --duration=900 --rollout-every=30 --list-rps=8 --stats-rps=8 --reconnect-pct=10 --concurrency=200 --output=./artifacts/mixed-10k.json
```

### 25k architecture decision gate

```bash
pnpm --filter @o11yfleet/load-test mixed -- --agents=25000 --duration=1200 --rollout-every=20 --list-rps=12 --stats-rps=12 --reconnect-pct=15 --concurrency=250 --output=./artifacts/mixed-25k.json
```

## How to interpret results

Directional evidence (useful but not final):

- one-off successful run,
- no severe failures under smoke scale,
- rollout/list/stats p95 near target with low variance.

Decision-grade evidence (gate quality):

- repeated runs (>=3) at same scale,
- stable p95 across runs,
- explicit confirmation from Worker/DO logs that no CPU-limit bursts dominate,
- reconnect recovery behavior validated in each run,
- post-rollout system returns to steady-state without growing failure trend.

## Starter SLO gates

- 10k run completes without CPU-limit errors.
- rollout push p95 < 5s (or revised with explicit rationale).
- API list p95 < 500ms (after pagination behavior is confirmed).
- no sustained recovery/backlog proxy growth after rollout + storm.
- reconnect storm recovers 95% of agents within 2 minutes.

## Gaps / missing evidence for 25k

For 25k decision quality, pair harness output with:

- Worker/DO CPU and error metrics,
- Analytics Engine config snapshots,
- logs filtered for websocket close/error spikes,
- repeated-run variance analysis.
