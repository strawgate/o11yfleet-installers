/**
 * agents list command
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

interface ListAgentsOptions {
  configId: string;
  stats: boolean;
}

export async function listAgents(opts: ListAgentsOptions): Promise<void> {
  const encodedConfigId = encodeURIComponent(opts.configId);

  if (opts.stats) {
    const resp = await apiRequest(`/api/v1/configurations/${encodedConfigId}/stats`);

    if (resp.error) {
      output.error(`Failed to get stats: ${resp.error}`);
      process.exit(1);
    }

    output.printJson(resp.data);
    return;
  }

  const resp = await apiRequest(`/api/v1/configurations/${encodedConfigId}/agents`);

  if (resp.error) {
    output.error(`Failed to list agents: ${resp.error}`);
    process.exit(1);
  }

  const data = resp.data as {
    agents?: Array<{ instance_uid: string; healthy: boolean; status: string }>;
  };
  const agents = Array.isArray(data?.agents) ? data.agents : [];

  if (agents.length === 0) {
    output.log("No agents connected");
    return;
  }

  output.printJson(data);
}
