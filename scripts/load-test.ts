#!/usr/bin/env npx tsx
/**
 * load-test.ts — WebSocket load tester for FleetPlane OpAMP server
 *
 * Spawns N concurrent fake OTel Collectors that connect via WebSocket,
 * enroll, send heartbeats, receive config pushes, and report metrics.
 *
 * Usage:
 *   pnpm tsx scripts/load-test.ts                         # 50 agents, 60s
 *   pnpm tsx scripts/load-test.ts --agents 200 --duration 120
 *   pnpm tsx scripts/load-test.ts --agents 500 --ramp 20  # 20 agents/sec ramp
 */

import { log, loadState, BASE_URL } from "./lib.js";
import {
  encodeFrame,
  decodeFrame,
  AgentCapabilities,
  RemoteConfigStatuses,
} from "@o11yfleet/core/codec";
import type { AgentToServer, ServerToAgent } from "@o11yfleet/core/codec";

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────
interface LoadTestOpts {
  agents: number;
  duration: number;      // seconds
  ramp: number;          // agents per second
  heartbeatMs: number;
  token: string;
  endpoint: string;
}

function parseArgs(): LoadTestOpts {
  const args = process.argv.slice(2);
  const opts: LoadTestOpts = {
    agents: 50,
    duration: 60,
    ramp: 10,
    heartbeatMs: 5_000, // faster than normal for load testing
    token: "",
    endpoint: BASE_URL.replace(/^http/, "ws") + "/v1/opamp",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--agents": opts.agents = parseInt(args[++i], 10); break;
      case "--duration": opts.duration = parseInt(args[++i], 10); break;
      case "--ramp": opts.ramp = parseInt(args[++i], 10); break;
      case "--heartbeat": opts.heartbeatMs = parseInt(args[++i], 10); break;
      case "--token": opts.token = args[++i]; break;
      case "--endpoint": opts.endpoint = args[++i]; break;
    }
  }

  if (!opts.token) {
    const state = loadState();
    if (state?.enrollment_token) {
      opts.token = state.enrollment_token;
    } else {
      log.error("No token. Run 'just seed' first or pass --token");
      process.exit(1);
    }
  }

  return opts;
}

// ──────────────────────────────────────────────
// Streaming Statistics (fixed memory)
// ──────────────────────────────────────────────
// Uses a reservoir sample (max 1000 entries) for percentile estimation.
// This bounds memory regardless of agent count or duration.

class StreamingStats {
  count = 0;
  sum = 0;
  private reservoir: number[] = [];
  private static readonly MAX_RESERVOIR = 1000;

  record(value: number): void {
    this.count++;
    this.sum += value;
    if (this.reservoir.length < StreamingStats.MAX_RESERVOIR) {
      this.reservoir.push(value);
    } else {
      // Reservoir sampling — uniform random replacement
      const j = Math.floor(Math.random() * this.count);
      if (j < StreamingStats.MAX_RESERVOIR) {
        this.reservoir[j] = value;
      }
    }
  }

  percentile(p: number): number {
    if (this.reservoir.length === 0) return 0;
    const sorted = [...this.reservoir].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  mean(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }
}

// ──────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────
interface MemorySample {
  timestamp: number;       // seconds since start
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  connectedAgents: number;
}

interface Metrics {
  connectAttempts: number;
  connectSuccesses: number;
  connectFailures: number;
  enrollments: number;
  heartbeatsSent: number;
  heartbeatRtts: StreamingStats;
  configPushesReceived: number;
  configAcksSent: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  disconnects: number;
  connectLatencies: StreamingStats;
  enrollLatencies: StreamingStats;
  memorySamples: MemorySample[];
}

function newMetrics(): Metrics {
  return {
    connectAttempts: 0,
    connectSuccesses: 0,
    connectFailures: 0,
    enrollments: 0,
    heartbeatsSent: 0,
    heartbeatRtts: new StreamingStats(),
    configPushesReceived: 0,
    configAcksSent: 0,
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    disconnects: 0,
    connectLatencies: new StreamingStats(),
    enrollLatencies: new StreamingStats(),
    memorySamples: [],
  };
}

function sampleMemory(metrics: Metrics, elapsedSec: number, connectedAgents: number): void {
  const mem = process.memoryUsage();
  metrics.memorySamples.push({
    timestamp: +elapsedSec.toFixed(1),
    heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2),
    rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
    externalMB: +(mem.external / 1024 / 1024).toFixed(2),
    connectedAgents,
  });
}

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(1)}ms`;
}

// ──────────────────────────────────────────────
// Agent
// ──────────────────────────────────────────────
interface LoadAgent {
  id: number;
  name: string;
  ws: WebSocket | null;
  state: "pending" | "connecting" | "enrolled" | "running" | "closed";
  instanceUid: Uint8Array;
  seqNum: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  connectStart: number;
  enrollStart: number;
  lastHeartbeatSent: number;
}

function createAgent(id: number): LoadAgent {
  return {
    id,
    name: `agent-${id}`,
    ws: null,
    state: "pending",
    instanceUid: crypto.getRandomValues(new Uint8Array(16)),
    seqNum: 0,
    heartbeatTimer: null,
    connectStart: 0,
    enrollStart: 0,
    lastHeartbeatSent: 0,
  };
}

// ──────────────────────────────────────────────
// Agent lifecycle
// ──────────────────────────────────────────────
function connectAgent(
  agent: LoadAgent,
  opts: LoadTestOpts,
  metrics: Metrics,
): Promise<void> {
  return new Promise((resolve) => {
    metrics.connectAttempts++;
    agent.state = "connecting";
    agent.connectStart = performance.now();
    agent.enrollStart = agent.connectStart;

    const wsUrl = `${opts.endpoint}?token=${encodeURIComponent(opts.token)}`;

    try {
      agent.ws = new WebSocket(wsUrl);
      agent.ws.binaryType = "arraybuffer";
    } catch {
      metrics.connectFailures++;
      agent.state = "closed";
      resolve();
      return;
    }

    const ws = agent.ws;

    ws.addEventListener("open", () => {
      const latency = performance.now() - agent.connectStart;
      metrics.connectSuccesses++;
      metrics.connectLatencies.record(latency);
      agent.state = "enrolled"; // will be refined once we get enrollment text msg

      // Send Hello
      agent.seqNum = 0;
      const hello: AgentToServer = {
        instance_uid: agent.instanceUid,
        sequence_num: agent.seqNum,
        capabilities:
          AgentCapabilities.ReportsStatus |
          AgentCapabilities.AcceptsRemoteConfig |
          AgentCapabilities.ReportsHealth |
          AgentCapabilities.ReportsRemoteConfig,
        flags: 0,
        health: {
          healthy: true,
          start_time_unix_nano: BigInt(Date.now()) * 1000000n,
          last_error: "",
          status: "running",
        },
        agent_description: {
          identifying_attributes: [
            { key: "service.name", value: agent.name },
          ],
          non_identifying_attributes: [
            { key: "os.type", value: process.platform },
          ],
        },
      };
      ws.send(encodeFrame(hello));
      metrics.messagesSent++;

      // Start heartbeat
      agent.heartbeatTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        agent.seqNum++;
        agent.lastHeartbeatSent = performance.now();
        const hb: AgentToServer = {
          instance_uid: agent.instanceUid,
          sequence_num: agent.seqNum,
          capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
          flags: 0,
        };
        ws.send(encodeFrame(hb));
        metrics.heartbeatsSent++;
        metrics.messagesSent++;
      }, opts.heartbeatMs);

      resolve(); // Connection established
    });

    ws.addEventListener("message", (event) => {
      metrics.messagesReceived++;

      // Text = enrollment
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "enrollment_complete") {
            const enrollLatency = performance.now() - agent.enrollStart;
            metrics.enrollments++;
            metrics.enrollLatencies.record(enrollLatency);
            agent.state = "running";
          }
        } catch { /* ignore */ }
        return;
      }

      // Binary = OpAMP
      const data = event.data instanceof ArrayBuffer ? event.data : null;
      if (!data) return;

      try {
        const msg = decodeFrame<ServerToAgent>(data);

        // Record heartbeat RTT
        if (agent.lastHeartbeatSent > 0 && !msg.remote_config) {
          const rtt = performance.now() - agent.lastHeartbeatSent;
          metrics.heartbeatRtts.record(rtt);
          agent.lastHeartbeatSent = 0;
        }

        // Handle config push
        if (msg.remote_config?.config_hash) {
          metrics.configPushesReceived++;
          agent.seqNum++;
          const ack: AgentToServer = {
            instance_uid: agent.instanceUid,
            sequence_num: agent.seqNum,
            capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
            flags: 0,
            remote_config_status: {
              last_remote_config_hash:
                msg.remote_config.config_hash instanceof Uint8Array
                  ? msg.remote_config.config_hash
                  : new Uint8Array(msg.remote_config.config_hash),
              status: RemoteConfigStatuses.APPLIED,
              error_message: "",
            },
          };
          ws.send(encodeFrame(ack));
          metrics.configAcksSent++;
          metrics.messagesSent++;
        }
      } catch {
        metrics.errors++;
      }
    });

    ws.addEventListener("close", () => {
      agent.state = "closed";
      metrics.disconnects++;
      if (agent.heartbeatTimer) clearInterval(agent.heartbeatTimer);
    });

    ws.addEventListener("error", () => {
      if (agent.state === "connecting") {
        metrics.connectFailures++;
        agent.state = "closed";
        resolve();
      }
      metrics.errors++;
    });

    // Timeout connect
    setTimeout(() => {
      if (agent.state === "connecting") {
        metrics.connectFailures++;
        agent.state = "closed";
        try { ws.close(); } catch {}
        resolve();
      }
    }, 10_000);
  });
}

function closeAgent(agent: LoadAgent): void {
  if (agent.heartbeatTimer) {
    clearInterval(agent.heartbeatTimer);
    agent.heartbeatTimer = null;
  }
  if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
    try { agent.ws.close(1000, "load test complete"); } catch {}
  }
  agent.state = "closed";
}

// ──────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────
function printProgress(agents: LoadAgent[], metrics: Metrics, elapsed: number): void {
  const connected = agents.filter(a => a.state === "running" || a.state === "enrolled").length;
  const closed = agents.filter(a => a.state === "closed").length;
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const rssMB = (mem.rss / 1024 / 1024).toFixed(1);

  process.stdout.write(
    `\r  ${connected} connected | ${closed} closed | ` +
    `${metrics.heartbeatsSent} heartbeats | ${metrics.configPushesReceived} config pushes | ` +
    `${metrics.errors} errors | heap ${heapMB}MB rss ${rssMB}MB | ${Math.round(elapsed)}s elapsed   `,
  );
}

function printReport(metrics: Metrics, durationSec: number): void {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  FleetPlane Load Test Results                            ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║  Duration:        ${durationSec}s`);
  console.log(`║  Connect attempts: ${metrics.connectAttempts}`);
  console.log(`║  Connected:        ${metrics.connectSuccesses} (${metrics.connectFailures} failed)`);
  console.log(`║  Enrollments:      ${metrics.enrollments}`);
  console.log(`║  Heartbeats sent:  ${metrics.heartbeatsSent}`);
  console.log(`║  Config pushes:    ${metrics.configPushesReceived}`);
  console.log(`║  Config ACKs:      ${metrics.configAcksSent}`);
  console.log(`║  Total TX:         ${metrics.messagesSent}`);
  console.log(`║  Total RX:         ${metrics.messagesReceived}`);
  console.log(`║  Errors:           ${metrics.errors}`);
  console.log(`║  Disconnects:      ${metrics.disconnects}`);
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║  Latency (connect)                                       ║");
  console.log(`║    p50: ${formatMs(metrics.connectLatencies.percentile(50)).padEnd(8)} p95: ${formatMs(metrics.connectLatencies.percentile(95)).padEnd(8)} p99: ${formatMs(metrics.connectLatencies.percentile(99))}`);
  console.log("║  Latency (enrollment)                                    ║");
  console.log(`║    p50: ${formatMs(metrics.enrollLatencies.percentile(50)).padEnd(8)} p95: ${formatMs(metrics.enrollLatencies.percentile(95)).padEnd(8)} p99: ${formatMs(metrics.enrollLatencies.percentile(99))}`);
  console.log("║  Latency (heartbeat RTT)                                 ║");
  console.log(`║    p50: ${formatMs(metrics.heartbeatRtts.percentile(50)).padEnd(8)} p95: ${formatMs(metrics.heartbeatRtts.percentile(95)).padEnd(8)} p99: ${formatMs(metrics.heartbeatRtts.percentile(99))}`);
  console.log("║  Throughput                                               ║");
  console.log(`║    TX: ${(metrics.messagesSent / durationSec).toFixed(1)} msg/s  RX: ${(metrics.messagesReceived / durationSec).toFixed(1)} msg/s`);
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log("║  Memory (client process)                                  ║");
  if (metrics.memorySamples.length > 0) {
    const peakHeap = Math.max(...metrics.memorySamples.map(s => s.heapUsedMB));
    const peakRss = Math.max(...metrics.memorySamples.map(s => s.rssMB));
    const finalSample = metrics.memorySamples[metrics.memorySamples.length - 1];
    const firstSample = metrics.memorySamples[0];
    const heapGrowth = finalSample.heapUsedMB - firstSample.heapUsedMB;
    const perAgentKB = metrics.connectSuccesses > 0
      ? ((finalSample.heapUsedMB - firstSample.heapUsedMB) * 1024 / metrics.connectSuccesses).toFixed(1)
      : "N/A";
    console.log(`║    Peak heap:    ${peakHeap.toFixed(1)} MB`);
    console.log(`║    Peak RSS:     ${peakRss.toFixed(1)} MB`);
    console.log(`║    Heap growth:  ${heapGrowth >= 0 ? "+" : ""}${heapGrowth.toFixed(1)} MB`);
    console.log(`║    Per agent:    ~${perAgentKB} KB heap`);
  }
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // JSON output for programmatic use
  console.log("\n--- JSON ---");
  console.log(JSON.stringify({
    duration_sec: durationSec,
    agents: metrics.connectSuccesses,
    connect_failures: metrics.connectFailures,
    enrollments: metrics.enrollments,
    heartbeats: metrics.heartbeatsSent,
    config_pushes: metrics.configPushesReceived,
    errors: metrics.errors,
    disconnects: metrics.disconnects,
    latency: {
      connect_p50_ms: +metrics.connectLatencies.percentile(50).toFixed(2),
      connect_p95_ms: +metrics.connectLatencies.percentile(95).toFixed(2),
      connect_p99_ms: +metrics.connectLatencies.percentile(99).toFixed(2),
      enroll_p50_ms: +metrics.enrollLatencies.percentile(50).toFixed(2),
      enroll_p95_ms: +metrics.enrollLatencies.percentile(95).toFixed(2),
      enroll_p99_ms: +metrics.enrollLatencies.percentile(99).toFixed(2),
      heartbeat_rtt_p50_ms: +metrics.heartbeatRtts.percentile(50).toFixed(2),
      heartbeat_rtt_p95_ms: +metrics.heartbeatRtts.percentile(95).toFixed(2),
      heartbeat_rtt_p99_ms: +metrics.heartbeatRtts.percentile(99).toFixed(2),
    },
    throughput: {
      tx_per_sec: +(metrics.messagesSent / durationSec).toFixed(1),
      rx_per_sec: +(metrics.messagesReceived / durationSec).toFixed(1),
    },
    memory: {
      peak_heap_mb: metrics.memorySamples.length > 0
        ? Math.max(...metrics.memorySamples.map(s => s.heapUsedMB))
        : 0,
      peak_rss_mb: metrics.memorySamples.length > 0
        ? Math.max(...metrics.memorySamples.map(s => s.rssMB))
        : 0,
      samples: metrics.memorySamples,
    },
  }, null, 2));
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main(): Promise<void> {
  const opts = parseArgs();
  const metrics = newMetrics();
  const agents: LoadAgent[] = [];

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  FleetPlane Load Test                                    ║");
  console.log(`║  Agents:     ${String(opts.agents).padEnd(6)} Duration: ${opts.duration}s`);
  console.log(`║  Ramp:       ${opts.ramp}/s     Heartbeat: ${opts.heartbeatMs}ms`);
  console.log(`║  Endpoint:   ${opts.endpoint.slice(0, 45)}`);
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");

  const startTime = performance.now();
  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    running = false;
    log.warn("Shutting down...");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Ramp up agents
  log.info(`Ramping up ${opts.agents} agents at ${opts.ramp}/s...`);

  let launched = 0;
  const rampInterval = setInterval(async () => {
    if (!running || launched >= opts.agents) {
      clearInterval(rampInterval);
      return;
    }

    const batch = Math.min(opts.ramp, opts.agents - launched);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < batch; i++) {
      const agent = createAgent(launched + i);
      agents.push(agent);
      promises.push(connectAgent(agent, opts, metrics));
    }

    launched += batch;
    await Promise.all(promises);

    if (launched >= opts.agents) {
      log.ok(`All ${opts.agents} agents launched`);
    }
  }, 1_000);

  // Progress reporting + memory sampling
  const progressInterval = setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    const connected = agents.filter(a => a.state === "running" || a.state === "enrolled").length;
    sampleMemory(metrics, elapsed, connected);
    printProgress(agents, metrics, elapsed);
  }, 2_000);

  // Wait for duration
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= opts.duration || !running) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 500);
  });

  // Cleanup
  clearInterval(rampInterval);
  clearInterval(progressInterval);

  log.info("Closing all connections...");
  for (const agent of agents) {
    closeAgent(agent);
  }

  // Brief pause for close frames to send
  await new Promise(r => setTimeout(r, 1_000));

  const totalDuration = (performance.now() - startTime) / 1000;
  printReport(metrics, Math.round(totalDuration));

  process.exit(0);
}

main().catch((err) => {
  log.error(`Fatal: ${err}`);
  process.exit(1);
});
