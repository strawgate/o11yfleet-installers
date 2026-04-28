/**
 * config list command
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

export async function listConfigs(): Promise<void> {
  const resp = await apiRequest("/api/v1/configurations");

  if (resp.error) {
    output.error(`Failed to list configs: ${resp.error}`);
    process.exit(1);
  }

  const data = resp.data as {
    configurations?: Array<{ id: string; name: string; current_config_hash?: string }>;
  };
  const configs = data?.configurations ?? [];

  if (configs.length === 0) {
    output.log("No configurations found");
    return;
  }

  if (output.jsonMode) {
    output.printJson(configs);
    return;
  }

  output.log("Configurations:");
  for (const config of configs) {
    output.log(`  ${config.id}  ${config.name}`);
    if (config.current_config_hash) {
      output.log(`    hash: ${config.current_config_hash.slice(0, 12)}...`);
    }
  }
}
