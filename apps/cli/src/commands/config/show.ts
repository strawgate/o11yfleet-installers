/**
 * config show command
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

interface ShowConfigOptions {
  configId: string;
}

export async function showConfig(opts: ShowConfigOptions): Promise<void> {
  const resp = await apiRequest(`/api/v1/configurations/${opts.configId}`);

  if (resp.error) {
    output.error(`Failed to get config: ${resp.error}`);
    process.exit(1);
  }

  output.printJson(resp.data);
}
