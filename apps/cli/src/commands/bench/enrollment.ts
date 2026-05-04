/**
 * bench enrollment command - measure how long it takes for collectors to enroll
 */

import { output } from "../../utils/output.js";
import { performance } from "node:perf_hooks";
import { apiRequest } from "../../utils/api.js";

interface BenchEnrollmentOptions {
  configId: string;
  collectors: number;
}

export async function benchEnrollment(opts: BenchEnrollmentOptions): Promise<void> {
  // Create enrollment token
  const tokenResp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/enrollment-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "bench-token" }),
    },
  );

  if (tokenResp.error || !tokenResp.data) {
    output.error("Failed to create enrollment token");
    process.exit(1);
  }

  // Measure stats fetch
  const start = performance.now();
  const statsResp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/stats`,
  );
  const elapsed = performance.now() - start;

  if (statsResp.error || !statsResp.data) {
    output.error("Failed to get stats");
    process.exit(1);
  }

  const stats = statsResp.data as { connected_agents: number; healthy_agents: number };

  output.exitJson({
    benchmarks: [
      {
        name: "enrollment",
        tags: { config_id: opts.configId, collectors: opts.collectors.toString() },
        metrics: {
          stats_fetch_ms: { value: elapsed, unit: "ms", direction: "smaller_is_better" },
          connected_agents: { value: stats.connected_agents, unit: "agents" },
          healthy_agents: { value: stats.healthy_agents, unit: "agents" },
        },
      },
    ],
  });
}
