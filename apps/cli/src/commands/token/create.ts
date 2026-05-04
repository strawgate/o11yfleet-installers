/**
 * token create command
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

interface CreateTokenOptions {
  configId: string;
  label?: string;
  expiresIn?: string;
}

export async function createToken(opts: CreateTokenOptions): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.label) body.label = opts.label;
  if (opts.expiresIn) {
    const parsed = parseInt(opts.expiresIn, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      body.expires_in_hours = parsed;
    }
  }

  const resp = await apiRequest(
    `/api/v1/configurations/${encodeURIComponent(opts.configId)}/enrollment-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (resp.error) {
    output.error(`Failed to create token: ${resp.error}`);
    process.exit(1);
  }

  const token = resp.data as { id: string; token: string; label?: string };
  output.success(`Token created: ${token.id}`);
  output.printJson(token);
}
