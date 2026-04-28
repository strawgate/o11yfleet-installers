/**
 * tenant create command
 */

import { output } from "../../utils/output.js";
import { getApiUrl } from "../../utils/config.js";

interface CreateTenantOptions {
  name: string;
  apiKey: string;
}

interface TenantResponse {
  id: string;
  name: string;
  plan: string;
}

export async function createTenant(opts: CreateTenantOptions): Promise<void> {
  const apiUrl = await getApiUrl();

  const resp = await fetch(`${apiUrl}/api/admin/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      name: opts.name,
      plan: "pro",
      max_configs: 100,
      max_agents_per_config: 100000,
    }),
  });

  if (!resp.ok) {
    const error = await resp.text().catch(() => "Failed to create tenant");
    output.error(`Failed to create tenant: ${error}`);
    process.exit(1);
  }

  const tenant = (await resp.json()) as TenantResponse;
  output.success(`Tenant created: ${tenant.id}`);
  output.printJson({ id: tenant.id, name: tenant.name, plan: tenant.plan });
}
