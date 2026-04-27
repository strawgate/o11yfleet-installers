#!/usr/bin/env npx tsx
/**
 * push-config.ts — Upload a YAML config and roll it out
 *
 * Usage:
 *   npx tsx scripts/push-config.ts configs/full-pipeline.yaml
 *   npx tsx scripts/push-config.ts configs/basic-otlp.yaml --no-rollout
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, log, loadState, saveState, BASE_URL } from "./lib.js";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const noRollout = process.argv.includes("--no-rollout");

  if (args.length === 0) {
    console.log("Usage: npx tsx scripts/push-config.ts <path-to-yaml> [--no-rollout]");
    console.log("\nAvailable configs:");
    console.log("  configs/basic-otlp.yaml      — Simple OTLP receiver");
    console.log("  configs/full-pipeline.yaml   — Multi-source with sampling");
    process.exit(1);
  }

  const state = loadState();
  if (!state) {
    log.error("No local state found. Run 'just seed' first.");
    process.exit(1);
  }

  const yamlPath = resolve(args[0]);
  log.info(`Reading config from ${yamlPath}`);

  let yaml: string;
  try {
    yaml = readFileSync(yamlPath, "utf-8");
  } catch {
    log.error(`Cannot read file: ${yamlPath}`);
    process.exit(1);
  }

  log.info(`Uploading to config ${state.config_name} (${state.config_id})...`);

  const { status, data } = await api<{
    hash: string;
    r2Key: string;
    sizeBytes: number;
    deduplicated: boolean;
  }>(`/api/configurations/${state.config_id}/versions`, {
    method: "POST",
    body: yaml,
    headers: { "Content-Type": "text/yaml" },
  });

  if (status !== 201) {
    log.error(`Upload failed (${status}): ${JSON.stringify(data)}`);
    process.exit(1);
  }

  log.ok(`Uploaded — hash: ${data.hash.slice(0, 16)}... size: ${data.sizeBytes}B dedup: ${data.deduplicated}`);

  // Update local state
  state.current_config_hash = data.hash;
  saveState(state);

  if (noRollout) {
    log.info("Skipping rollout (--no-rollout)");
    return;
  }

  // Rollout
  log.info("Rolling out to connected agents...");
  const { status: rs, data: rollout } = await api<{ pushed: number; config_hash: string }>(
    `/api/configurations/${state.config_id}/rollout`,
    { method: "POST" },
  );

  if (rs !== 200) {
    log.error(`Rollout failed (${rs}): ${JSON.stringify(rollout)}`);
    process.exit(1);
  }

  log.ok(`Rollout complete — pushed to ${rollout.pushed} connected agent(s)`);
  log.ok(`Config hash: ${rollout.config_hash.slice(0, 16)}...`);
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
