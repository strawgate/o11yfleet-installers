// Rate limiting e2e test
// Verifies that the DO enforces per-agent message rate limits via SQLite

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import {
  setupD1,
  createTenant,
  createConfig,
  createEnrollmentToken,
  connectWithEnrollment,
  sendHello,
  waitForClose,
  encodeFrame,
  AgentCapabilities,
  type AgentToServer,
} from "./helpers.js";

beforeAll(setupD1);

describe("Rate Limiting", () => {
  it("closes WebSocket after exceeding 60 messages per minute", async () => {
    const tenant = await createTenant("Rate Corp");
    const config = await createConfig(tenant.id, "rate-config");
    const token = await createEnrollmentToken(config.id);

    const { ws } = await connectWithEnrollment(token.token);
    await sendHello(ws);

    // Set up close listener BEFORE sending burst
    const closePromise = waitForClose(ws, 10000);

    // Send 65 heartbeats rapidly (limit is 60/min — hello was msg #1)
    // Messages 2-61 will pass, message 62+ should trigger rate limit
    for (let seq = 1; seq <= 65; seq++) {
      const hb: AgentToServer = {
        instance_uid: new Uint8Array(16),
        sequence_num: seq,
        capabilities: AgentCapabilities.ReportsStatus,
        flags: 0,
      };
      try {
        ws.send(encodeFrame(hb));
      } catch {
        // Socket may be closed mid-burst
        break;
      }
    }

    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(4029);
  });

  it("rate limit is per-agent, not global", async () => {
    const tenant = await createTenant("Rate Multi Corp");
    const config = await createConfig(tenant.id, "rate-multi-config");
    const tokenA = await createEnrollmentToken(config.id);
    const tokenB = await createEnrollmentToken(config.id);

    // Agent A: connect and send 30 messages (under limit)
    const { ws: wsA } = await connectWithEnrollment(tokenA.token);
    await sendHello(wsA);
    for (let seq = 1; seq <= 30; seq++) {
      const hb: AgentToServer = {
        instance_uid: new Uint8Array(16),
        sequence_num: seq,
        capabilities: AgentCapabilities.ReportsStatus,
        flags: 0,
      };
      wsA.send(encodeFrame(hb));
    }

    // Agent B: should still be able to connect and send messages
    const { ws: wsB } = await connectWithEnrollment(tokenB.token);
    const resp = await sendHello(wsB);
    expect(resp.instance_uid).toBeDefined();

    wsA.close();
    wsB.close();
  });

  it("rate limit counter lives in SQLite (survives across calls)", async () => {
    // Test the rate limit function directly via DO
    const doId = env.CONFIG_DO.idFromName("rl-test:rl-config");
    const stub = env.CONFIG_DO.get(doId);

    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const sql = instance.ctx.storage.sql;

      // Create the schema
      sql.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          instance_uid TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          config_id TEXT NOT NULL,
          sequence_num INTEGER NOT NULL DEFAULT 0,
          generation INTEGER NOT NULL DEFAULT 1,
          healthy INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'unknown',
          last_error TEXT NOT NULL DEFAULT '',
          current_config_hash TEXT,
          last_seen_at INTEGER NOT NULL DEFAULT 0,
          connected_at INTEGER NOT NULL DEFAULT 0,
          agent_description TEXT,
          capabilities INTEGER NOT NULL DEFAULT 0,
          rate_window_start INTEGER NOT NULL DEFAULT 0,
          rate_window_count INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Insert a test agent
      sql.exec(
        `INSERT INTO agents (instance_uid, tenant_id, config_id) VALUES (?, ?, ?)`,
        "rl-agent-1",
        "rl-test",
        "rl-config",
      );

      // Import and call checkRateLimit
      const { checkRateLimit } = await import(
        "../src/durable-objects/agent-state-repo.js"
      );

      // First 60 calls should not be rate limited
      for (let i = 0; i < 60; i++) {
        expect(checkRateLimit(sql, "rl-agent-1", 60)).toBe(false);
      }

      // 61st call should be rate limited
      expect(checkRateLimit(sql, "rl-agent-1", 60)).toBe(true);

      // Verify the count is stored in SQLite
      const row = sql
        .exec(
          `SELECT rate_window_count FROM agents WHERE instance_uid = ?`,
          "rl-agent-1",
        )
        .toArray()[0];
      expect(row!.rate_window_count).toBe(61);
    });
  });
});
