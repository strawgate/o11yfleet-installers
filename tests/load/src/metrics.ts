// Load test metrics — percentile tracking and reporting (zero dependencies)

export interface LatencyTracker {
  name: string;
  samples: number[];
}

export function createTracker(name: string): LatencyTracker {
  return { name, samples: [] };
}

export function record(tracker: LatencyTracker, valueMs: number): void {
  tracker.samples.push(valueMs);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export interface TrackerSummary {
  name: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export function summarize(tracker: LatencyTracker): TrackerSummary {
  const sorted = [...tracker.samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    name: tracker.name,
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export interface CounterSet {
  connectAttempted: number;
  connectSucceeded: number;
  connectFailed: number;
  messagesSent: number;
  messagesReceived: number;
  enrollmentCompleted: number;
  errors: Map<string, number>;
}

export function createCounters(): CounterSet {
  return {
    connectAttempted: 0,
    connectSucceeded: 0,
    connectFailed: 0,
    messagesSent: 0,
    messagesReceived: 0,
    enrollmentCompleted: 0,
    errors: new Map(),
  };
}

export function countError(counters: CounterSet, type: string): void {
  counters.errors.set(type, (counters.errors.get(type) ?? 0) + 1);
}

export interface LoadTestReport {
  target: string;
  agents: number;
  rampUpSeconds: number;
  steadyStateSeconds: number;
  heartbeatIntervalSeconds: number;
  counters: CounterSet;
  connect: TrackerSummary;
  enrollment: TrackerSummary;
  heartbeatRtt: TrackerSummary;
  peakMemoryMB: number;
  durationSeconds: number;
}

export function printReport(report: LoadTestReport): void {
  const fmt = (n: number) => n.toFixed(1);
  const errors =
    [...report.counters.errors.entries()].map(([k, v]) => `${k}=${v}`).join(", ") || "none";

  console.log(`
╔══════════════════════════════════════════════════════════╗
║           FleetPlane WebSocket Load Test Results         ║
╚══════════════════════════════════════════════════════════╝

  Target:     ${report.target}
  Agents:     ${report.agents}
  Ramp-up:    ${report.rampUpSeconds}s
  Steady:     ${report.steadyStateSeconds}s
  Heartbeat:  every ${report.heartbeatIntervalSeconds}s
  Duration:   ${fmt(report.durationSeconds)}s

┌─────────────────────────────┬────────────┐
│ Metric                      │ Value      │
├─────────────────────────────┼────────────┤
│ Connections attempted       │ ${String(report.counters.connectAttempted).padStart(10)} │
│ Connections succeeded       │ ${String(report.counters.connectSucceeded).padStart(10)} │
│ Connections failed          │ ${String(report.counters.connectFailed).padStart(10)} │
│ Enrollments completed       │ ${String(report.counters.enrollmentCompleted).padStart(10)} │
│ Messages sent               │ ${String(report.counters.messagesSent).padStart(10)} │
│ Messages received           │ ${String(report.counters.messagesReceived).padStart(10)} │
├─────────────────────────────┼────────────┤
│ Connect P50                 │ ${fmt(report.connect.p50).padStart(8)}ms │
│ Connect P95                 │ ${fmt(report.connect.p95).padStart(8)}ms │
│ Connect P99                 │ ${fmt(report.connect.p99).padStart(8)}ms │
├─────────────────────────────┼────────────┤
│ Enrollment P50              │ ${fmt(report.enrollment.p50).padStart(8)}ms │
│ Enrollment P95              │ ${fmt(report.enrollment.p95).padStart(8)}ms │
│ Enrollment P99              │ ${fmt(report.enrollment.p99).padStart(8)}ms │
├─────────────────────────────┼────────────┤
│ Heartbeat RTT P50           │ ${fmt(report.heartbeatRtt.p50).padStart(8)}ms │
│ Heartbeat RTT P95           │ ${fmt(report.heartbeatRtt.p95).padStart(8)}ms │
│ Heartbeat RTT P99           │ ${fmt(report.heartbeatRtt.p99).padStart(8)}ms │
├─────────────────────────────┼────────────┤
│ Peak memory (RSS)           │ ${fmt(report.peakMemoryMB).padStart(7)}MB │
│ Errors                      │ ${errors.padStart(10)} │
└─────────────────────────────┴────────────┘
`);
}

export function reportToJson(report: LoadTestReport): string {
  return JSON.stringify(
    {
      ...report,
      counters: {
        ...report.counters,
        errors: Object.fromEntries(report.counters.errors),
      },
    },
    null,
    2,
  );
}
