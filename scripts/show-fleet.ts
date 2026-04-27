#!/usr/bin/env npx tsx
/**
 * show-fleet.ts — Display fleet status
 *
 * Shows connected agents, config status, and DO stats.
 *
 * Usage: npx tsx scripts/show-fleet.ts
 */

import { api, log, loadState, BASE_URL } from "./lib.js";

interface Agent {
  instance_uid: string;
  tenant_id: string;
  config_id: string;
  status: string;
  healthy: number;
  current_config_hash: string | null;
  last_seen_at: string | null;
  connected_at: string | null;
  agent_description: string | null;
}

interface Stats {
  total_agents: number;
  connected_agents: number;
  healthy_agents: number;
  desired_config_hash: string | null;
  active_websockets: number;
}

interface Config {
  id: string;
  name: string;
  tenant_id: string;
  current_config_hash: string | null;
  created_at: string;
}

async function main() {
  const state = loadState();
  if (!state) {
    log.error("No local state found. Run 'just seed' first.");
    process.exit(1);
  }

  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  FleetPlane Fleet Status                      ║`);
  console.log(`║  Server: ${BASE_URL.padEnd(37)}║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  // Tenant info
  console.log(`📋 Tenant: ${state.tenant_name} (${state.tenant_id})`);
  console.log(`📦 Config: ${state.config_name} (${state.config_id})\n`);

  // Config details
  const { data: config } = await api<Config>(`/api/configurations/${state.config_id}`);
  if (config) {
    console.log("─── Configuration ────────────────────────────");
    console.log(`  Current hash: ${config.current_config_hash?.slice(0, 24) ?? "none"}...`);
    console.log(`  Created:      ${config.created_at}`);
    console.log();
  }

  // DO stats (live WebSocket state)
  const { status: ss, data: stats } = await api<Stats>(
    `/api/configurations/${state.config_id}/stats`,
  );
  if (ss === 200 && stats) {
    console.log("─── Live Stats (Durable Object) ──────────────");
    console.log(`  Active WebSockets: ${stats.active_websockets}`);
    console.log(`  Total agents:      ${stats.total_agents}`);
    console.log(`  Connected:         ${stats.connected_agents}`);
    console.log(`  Healthy:           ${stats.healthy_agents}`);
    console.log(
      `  Desired config:    ${stats.desired_config_hash?.slice(0, 24) ?? "not set"}...`,
    );
    console.log();
  }

  // Agent list (from D1 read model)
  const { status: as, data: agentData } = await api<{ agents: Agent[] }>(
    `/api/configurations/${state.config_id}/agents`,
  );
  if (as === 200 && agentData?.agents) {
    const agents = agentData.agents;
    if (agents.length === 0) {
      console.log("─── Agents ───────────────────────────────────");
      console.log("  (no agents registered yet)");
      console.log("  Run 'just collector' to start a fake agent");
      console.log();
    } else {
      console.log(`─── Agents (${agents.length}) ──────────────────────────────`);
      console.log(
        "  UID              Status       Healthy  Config Hash       Last Seen",
      );
      console.log("  " + "─".repeat(80));
      for (const a of agents) {
        const uid = a.instance_uid.slice(0, 16);
        const status = a.status.padEnd(12);
        const healthy = a.healthy ? "✓" : "✗";
        const hash = a.current_config_hash?.slice(0, 16) ?? "(none)";
        const seen = a.last_seen_at ?? "never";
        console.log(`  ${uid}  ${status} ${healthy.padEnd(8)} ${hash.padEnd(18)} ${seen}`);
      }
      console.log();
    }
  }

  // List configurations for tenant
  const { data: configsData } = await api<{ configurations: Config[] }>(
    `/api/tenants/${state.tenant_id}/configurations`,
  );
  if (configsData?.configurations && configsData.configurations.length > 0) {
    console.log(
      `─── All Configurations (${configsData.configurations.length}) ─────────────────────`,
    );
    for (const c of configsData.configurations) {
      const marker = c.id === state.config_id ? "→ " : "  ";
      console.log(
        `${marker}${c.name} (${c.id.slice(0, 8)}...) — hash: ${c.current_config_hash?.slice(0, 16) ?? "none"}`,
      );
    }
    console.log();
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
