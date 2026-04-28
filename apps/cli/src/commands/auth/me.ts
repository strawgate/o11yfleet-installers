/**
 * auth me command - show current user
 */

import { output } from "../../utils/output.js";
import { apiRequest } from "../../utils/api.js";

export async function me(): Promise<void> {
  const resp = await apiRequest("/auth/me");

  if (resp.error || !resp.data) {
    output.error("Not logged in or session expired");
    process.exit(1);
  }

  const data = resp.data as { user?: { userId: string; email: string; tenantId?: string } };

  if (!data.user) {
    output.error("Not authenticated");
    process.exit(1);
  }

  if (output.jsonMode) {
    output.exitJson(data);
  }

  output.printJson(data);
}
