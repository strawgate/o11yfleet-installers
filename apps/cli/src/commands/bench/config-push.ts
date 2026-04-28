/**
 * bench config-push command - measure config upload and rollout time
 */

import { output } from "../../utils/output.js";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { apiRequest } from "../../utils/api.js";

interface BenchConfigPushOptions {
  configId: string;
  file?: string;
}

const DEFAULT_CONFIG = `exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    metrics:
      receivers: []
      exporters: [debug]
`;

export async function benchConfigPush(opts: BenchConfigPushOptions): Promise<void> {
  let configYaml: string;
  if (opts.file) {
    try {
      configYaml = await readFile(opts.file, "utf-8");
    } catch (err) {
      output.error(
        `Failed to read file ${opts.file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  } else {
    configYaml = DEFAULT_CONFIG;
  }

  // Measure upload
  const uploadStart = performance.now();
  const uploadResp = await apiRequest(`/api/v1/configurations/${opts.configId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: configYaml,
  });
  const uploadMs = performance.now() - uploadStart;

  if (uploadResp.error || !uploadResp.data) {
    output.error("Failed to upload config");
    process.exit(1);
  }

  // Measure rollout
  const rolloutStart = performance.now();
  const rolloutResp = await apiRequest(`/api/v1/configurations/${opts.configId}/rollout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const rolloutMs = performance.now() - rolloutStart;

  if (rolloutResp.error) {
    output.error("Failed to rollout");
    process.exit(1);
  }

  const totalMs = uploadMs + rolloutMs;

  output.exitJson({
    benchmarks: [
      {
        name: "config-push",
        tags: { config_id: opts.configId },
        metrics: {
          upload_ms: { value: uploadMs, unit: "ms", direction: "smaller_is_better" },
          rollout_ms: { value: rolloutMs, unit: "ms", direction: "smaller_is_better" },
          total_ms: { value: totalMs, unit: "ms", direction: "smaller_is_better" },
        },
      },
    ],
  });
}
