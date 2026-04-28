/**
 * bench provisioning command - measure tenant + config + token creation time
 */

import { output } from "../../utils/output.js";
import { performance } from "node:perf_hooks";
import { getApiUrl } from "../../utils/config.js";

interface BenchProvisioningOptions {
  apiKey: string;
  name?: string;
}

export async function benchProvisioning(opts: BenchProvisioningOptions): Promise<void> {
  const apiUrl = await getApiUrl();
  const tenantName = opts.name || "bench-tenant";

  // Measure tenant creation
  const tenantStart = performance.now();
  const tenantResp = await fetch(`${apiUrl}/api/admin/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      name: tenantName,
      plan: "pro",
      max_configs: 100,
      max_agents_per_config: 100000,
    }),
  });
  const tenantMs = performance.now() - tenantStart;

  if (!tenantResp.ok) {
    output.error(`Failed to create tenant: ${await tenantResp.text()}`);
    process.exit(1);
  }

  const tenant = (await tenantResp.json()) as { id: string };
  const tenantId = tenant.id;

  // Measure config creation
  const configStart = performance.now();
  const configResp = await fetch(`${apiUrl}/api/v1/configurations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify({ name: "bench-config" }),
  });
  const configMs = performance.now() - configStart;

  if (!configResp.ok) {
    output.error(`Failed to create config: ${await configResp.text()}`);
    process.exit(1);
  }

  const config = (await configResp.json()) as { id: string };
  const configId = config.id;

  // Measure token creation
  const tokenStart = performance.now();
  const tokenResp = await fetch(`${apiUrl}/api/v1/configurations/${configId}/enrollment-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "X-Tenant-Id": tenantId,
    },
    body: JSON.stringify({ label: "bench-token" }),
  });
  const tokenMs = performance.now() - tokenStart;

  if (!tokenResp.ok) {
    output.error(`Failed to create token: ${await tokenResp.text()}`);
    process.exit(1);
  }

  const totalMs = tenantMs + configMs + tokenMs;

  output.exitJson({
    benchmarks: [
      {
        name: "provisioning",
        tags: { tenant_name: tenantName },
        metrics: {
          createTenant_ms: { value: tenantMs, unit: "ms", direction: "smaller_is_better" },
          createConfig_ms: { value: configMs, unit: "ms", direction: "smaller_is_better" },
          createToken_ms: { value: tokenMs, unit: "ms", direction: "smaller_is_better" },
          total_ms: { value: totalMs, unit: "ms", direction: "smaller_is_better" },
        },
      },
    ],
  });
}
