/**
 * token list command
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

interface ListTokensOptions {
  configId: string;
}

export async function listTokens(opts: ListTokensOptions): Promise<void> {
  const resp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/enrollment-tokens`,
  );

  if (resp.error) {
    output.error(`Failed to list tokens: ${resp.error}`);
    process.exit(1);
  }

  const data = resp.data as {
    tokens?: Array<{ id: string; label?: string; expires_at?: string; revoked_at?: string }>;
  };
  const tokens = Array.isArray(data?.tokens) ? data.tokens : [];

  if (tokens.length === 0) {
    output.log("No tokens found");
    return;
  }

  output.printJson(data);
}
