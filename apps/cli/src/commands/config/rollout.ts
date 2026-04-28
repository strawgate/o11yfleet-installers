/**
 * config rollout command
 */

import { performance } from "node:perf_hooks";
import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

interface RolloutConfigOptions {
  configId: string;
}

export async function rolloutConfig(opts: RolloutConfigOptions): Promise<void> {
  const start = performance.now();
  const resp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/rollout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );
  const elapsed = performance.now() - start;

  if (resp.error) {
    output.error(`Failed to rollout: ${resp.error}`);
    process.exit(1);
  }

  output.success(`Rollout initiated (${elapsed.toFixed(0)}ms)`);
  output.printJson({ configId: opts.configId, elapsed_ms: elapsed });
}
