/**
 * Phase 5 — Performance Benchmark Harness
 *
 * Benchmarks:
 * 1. 10k frame encodes
 * 2. 10k frame decodes
 * 3. 10k state machine transitions
 * 4. 1k agents × 100 messages (state machine throughput)
 *
 * Output: JSON with p50/p95/p99 latency per operation
 */

import { encodeFrame, decodeFrame } from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";
import { AgentCapabilities } from "@o11yfleet/core/codec";
import { processFrame } from "@o11yfleet/core/state-machine";
import type { AgentState } from "@o11yfleet/core/state-machine";

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  opsPerSec: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function bench(name: string, iterations: number, fn: () => void): BenchResult {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations); i++) fn();

  const latencies: number[] = [];
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    latencies.push((performance.now() - t0) * 1000); // microseconds
  }
  const totalMs = performance.now() - start;

  latencies.sort((a, b) => a - b);
  return {
    name,
    iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    p50Us: Math.round(percentile(latencies, 50) * 100) / 100,
    p95Us: Math.round(percentile(latencies, 95) * 100) / 100,
    p99Us: Math.round(percentile(latencies, 99) * 100) / 100,
  };
}

// Test data
const sampleMsg: AgentToServer = {
  instance_uid: new Uint8Array(16).fill(0xab),
  sequence_num: 42,
  capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
  flags: 0,
  health: {
    healthy: true,
    start_time_unix_nano: 1700000000000000000n,
    last_error: "",
    status: "running",
    status_time_unix_nano: 1700000000000000000n,
    component_health_map: {},
  },
};

const encoded = encodeFrame(sampleMsg);

const baseState: AgentState = {
  instance_uid: new Uint8Array(16).fill(0xab),
  tenant_id: "bench-tenant",
  config_id: "bench-config",
  sequence_num: 0,
  generation: 1,
  healthy: true,
  status: "running",
  last_error: "",
  current_config_hash: null,
  desired_config_hash: null,
  capabilities: AgentCapabilities.ReportsStatus,
  last_seen_at: Date.now(),
  connected_at: Date.now(),
  agent_description: null,
};

console.log("o11yfleet Performance Benchmark");
console.log("================================\n");

const results: BenchResult[] = [];

// Benchmark 1: Encode
results.push(
  bench("encodeFrame", 10_000, () => {
    encodeFrame(sampleMsg);
  }),
);

// Benchmark 2: Decode
results.push(
  bench("decodeFrame", 10_000, () => {
    decodeFrame(encoded);
  }),
);

// Benchmark 3: State machine transitions
let seq = 0;
results.push(
  bench("processFrame", 10_000, () => {
    seq++;
    processFrame(
      { ...baseState, sequence_num: seq - 1 },
      {
        instance_uid: new Uint8Array(16),
        sequence_num: seq,
        capabilities: AgentCapabilities.ReportsStatus,
        flags: 0,
      },
    );
  }),
);

// Benchmark 4: 1k agents × 100 messages
{
  const start = performance.now();
  const agentCount = 1000;
  const msgsPerAgent = 100;
  let totalOps = 0;

  for (let a = 0; a < agentCount; a++) {
    let state: AgentState = {
      ...baseState,
      instance_uid: new Uint8Array(16).fill(a % 256),
      sequence_num: 0,
    };
    for (let m = 0; m < msgsPerAgent; m++) {
      const result = processFrame(state, {
        instance_uid: state.instance_uid,
        sequence_num: m + 1,
        capabilities: AgentCapabilities.ReportsStatus,
        flags: 0,
      });
      state = result.newState;
      totalOps++;
    }
  }

  const totalMs = performance.now() - start;
  results.push({
    name: `${agentCount} agents × ${msgsPerAgent} msgs`,
    iterations: totalOps,
    totalMs: Math.round(totalMs * 100) / 100,
    opsPerSec: Math.round(totalOps / (totalMs / 1000)),
    p50Us: 0,
    p95Us: 0,
    p99Us: 0,
  });
}

// Print results
console.log("| Benchmark | Iterations | Total (ms) | ops/sec | p50 (µs) | p95 (µs) | p99 (µs) |");
console.log("|-----------|-----------|-----------|---------|----------|----------|----------|");
for (const r of results) {
  console.log(
    `| ${r.name.padEnd(35)} | ${String(r.iterations).padStart(9)} | ${String(r.totalMs).padStart(9)} | ${String(r.opsPerSec).padStart(7)} | ${String(r.p50Us).padStart(8)} | ${String(r.p95Us).padStart(8)} | ${String(r.p99Us).padStart(8)} |`,
  );
}

console.log("\n--- JSON Output ---");
console.log(JSON.stringify(results, null, 2));
