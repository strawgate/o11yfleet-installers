#!/usr/bin/env npx tsx
/**
 * seed-local.ts — Bootstrap local dev environment
 *
 * Creates a tenant, configuration, uploads a sample YAML config,
 * and generates an enrollment token. Saves results to .local-state.json.
 *
 * Usage: npx tsx scripts/seed-local.ts [--reset]
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { api, log, saveState, loadState, stateFilePath, BASE_URL, requireApiKey } from "./lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const reset = process.argv.includes("--reset");

  log.info(`o11yfleet Local Seed — targeting ${BASE_URL}`);

  // Check health first
  try {
    const health = await fetch(`${BASE_URL}/healthz`);
    if (!health.ok) throw new Error(`status ${health.status}`);
    log.ok("Worker is healthy");
  } catch {
    log.error(`Cannot reach worker at ${BASE_URL}/healthz`);
    log.error("Run 'just dev' first to start the local worker");
    process.exit(1);
  }

  requireApiKey();

  log.info("Seeding local login accounts...");
  const { status: seedStatus } = await api<{ seeded: string[]; tenantId: string }>("/auth/seed", {
    method: "POST",
  });
  if (seedStatus !== 200) {
    log.error(`Failed to seed login accounts: status ${seedStatus}`);
    process.exit(1);
  }
  log.ok("Login accounts ready");

  // Check for existing state
  const existing = loadState();
  if (existing && !reset) {
    log.warn(`Local state already exists at ${stateFilePath()}`);
    log.info(`  Tenant:     ${existing.tenant_name} (${existing.tenant_id})`);
    log.info(`  Config:     ${existing.config_name} (${existing.config_id})`);
    log.info(`  Token:      ${existing.enrollment_token.slice(0, 20)}...`);
    if (existing.assignment_claim) {
      log.info(`  Claim:      ${existing.assignment_claim.slice(0, 30)}...`);
    }
    log.info("Use --reset to recreate. Exiting.");
    return;
  }

  // 1. Create tenant
  log.info("Creating tenant...");
  const { status: ts, data: tenant } = await api<{ id: string; name: string; plan: string }>(
    "/api/admin/tenants",
    { method: "POST", body: JSON.stringify({ name: "Local Dev", plan: "free" }) },
  );
  if (ts !== 201) {
    log.error(`Failed to create tenant: ${JSON.stringify(tenant)}`);
    process.exit(1);
  }
  log.ok(`Tenant: ${tenant.name} (${tenant.id}) — plan: ${tenant.plan}`);

  // 2. Create configuration
  log.info("Creating configuration...");
  const { status: cs, data: config } = await api<{ id: string; name: string }>(
    "/api/v1/configurations",
    {
      method: "POST",
      body: JSON.stringify({
        name: "dev-collectors",
        description: "Local development OTel collector config",
      }),
    },
    tenant.id,
  );
  if (cs !== 201) {
    log.error(`Failed to create configuration: ${JSON.stringify(config)}`);
    process.exit(1);
  }
  log.ok(`Configuration: ${config.name} (${config.id})`);

  // 3. Upload initial YAML config
  log.info("Uploading initial config (basic-otlp.yaml)...");
  const yamlPath = resolve(__dirname, "..", "configs", "basic-otlp.yaml");
  const yaml = readFileSync(yamlPath, "utf-8");
  const { status: us, data: upload } = await api<{
    hash: string;
    sizeBytes: number;
    deduplicated: boolean;
  }>(
    `/api/v1/configurations/${config.id}/versions`,
    {
      method: "POST",
      body: yaml,
      headers: { "Content-Type": "text/yaml" },
    },
    tenant.id,
  );
  if (us !== 201) {
    log.error(`Failed to upload config: ${JSON.stringify(upload)}`);
    process.exit(1);
  }
  log.ok(`Config uploaded — hash: ${upload.hash.slice(0, 16)}... (${upload.sizeBytes} bytes)`);

  // 4. Create enrollment token
  log.info("Generating enrollment token...");
  const { status: ets, data: enrollData } = await api<{
    id: string;
    token: string;
    config_id: string;
  }>(
    `/api/v1/configurations/${config.id}/enrollment-token`,
    {
      method: "POST",
      body: JSON.stringify({ label: "local-dev" }),
    },
    tenant.id,
  );
  if (ets !== 201) {
    log.error(`Failed to create enrollment token: ${JSON.stringify(enrollData)}`);
    process.exit(1);
  }
  log.ok(`Enrollment token: ${enrollData.token.slice(0, 25)}...`);

  // 5. Rollout the config
  log.info("Rolling out config to connected agents (none yet)...");
  const { status: rs, data: rollout } = await api<{ pushed: number }>(
    `/api/v1/configurations/${config.id}/rollout`,
    { method: "POST" },
    tenant.id,
  );
  if (rs === 200) {
    log.ok(`Rollout complete — pushed to ${(rollout as { pushed: number }).pushed} agents`);
  }

  // Save state
  const state = {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    config_id: config.id,
    config_name: config.name,
    enrollment_token: enrollData.token,
    current_config_hash: upload.hash,
  };
  saveState(state);
  log.ok(`State saved to ${stateFilePath()}`);

  console.log("\n┌─────────────────────────────────────────┐");
  console.log("│  Local dev environment ready!            │");
  console.log("├─────────────────────────────────────────┤");
  console.log("│  Next steps:                            │");
  console.log("│    just collector   — start fake agent  │");
  console.log("│    just push-config — push new config   │");
  console.log("│    just fleet       — view fleet status │");
  console.log("└─────────────────────────────────────────┘");
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
