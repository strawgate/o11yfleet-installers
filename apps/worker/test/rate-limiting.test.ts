// Tiered persistence e2e tests
// Verifies that the DO's write optimization correctly skips SQLite writes
// on no-op heartbeats while preserving correctness on state changes.
//
// Rate limiting was removed from the DO because:
// 1. The rate limiter was a SQLite WRITE on every message — more expensive
//    than the read operations it was protecting.
// 2. By the time rate-limit code runs, the DO is already awake and JS is
//    executing — the cost is paid.
// 3. The DO's single-threaded model (~500-1000 msg/sec) is the natural throttle.
// 4. Edge-level CF WAF Rate Limiting Rules handle connection storms.
// See apps/worker/src/durable-objects/AGENTS.md for full analysis.

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import {
  bootstrapSchema,
  createTenant,
  createConfig,
  createEnrollmentToken,
  connectWithEnrollment,
  sendHello,
  sendHeartbeat,
  encodeFrame,
  waitForMsg,
  buildHealthReport,
} from "./helpers.js";

beforeAll(() => bootstrapSchema());

describe("Tiered Persistence", () => {
  it("no-op heartbeats do not write to SQLite (seq tracked in WS attachment)", async () => {
    const tenant = await createTenant("Tier Corp");
    const config = await createConfig(tenant.id, "tier-config");
    const token = await createEnrollmentToken(config.id);
    const { ws, instanceUid } = await connectWithEnrollment(token.token);

    // Hello triggers a full persist (state change: connected)
    await sendHello(ws);

    // Capture the sequence_num in SQLite after hello
    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);

    let seqAfterHello: number;
    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const row = instance.ctx.storage.sql
        .exec(`SELECT sequence_num FROM agents WHERE instance_uid = ?`, instanceUid)
        .toArray()[0];
      seqAfterHello = row!["sequence_num"] as number;
    });

    // Send several no-op heartbeats — these should NOT update SQLite
    for (let seq = seqAfterHello! + 1; seq <= seqAfterHello! + 5; seq++) {
      await sendHeartbeat(ws, seq);
    }

    // Verify SQLite still has the old sequence_num
    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const row = instance.ctx.storage.sql
        .exec(`SELECT sequence_num FROM agents WHERE instance_uid = ?`, instanceUid)
        .toArray()[0];
      expect(row!["sequence_num"] as number).toBe(seqAfterHello!);
    });

    ws.close();
  });

  it("health change uses targeted UPDATE (Tier 1), not full UPSERT", async () => {
    const tenant = await createTenant("Tier1 Corp");
    const config = await createConfig(tenant.id, "tier1-config");
    const token = await createEnrollmentToken(config.id);
    const { ws, instanceUid } = await connectWithEnrollment(token.token);

    // Hello triggers full UPSERT (Tier 2)
    await sendHello(ws);

    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);

    // Set a sentinel value on agent_description via SQL so we can verify
    // Tier 1 doesn't overwrite it.
    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      instance.ctx.storage.sql.exec(
        `UPDATE agents SET agent_description = ? WHERE instance_uid = ?`,
        '{"sentinel":"tier1-test"}',
        instanceUid,
      );
    });

    // Send a health change message — this is a Tier 1 write.
    // It should update health columns but NOT touch agent_description.
    const healthMsg = buildHealthReport({
      sequenceNum: 1,
      healthy: false,
      status: "degraded",
      lastError: "test-error",
    });
    ws.send(encodeFrame(healthMsg));
    await waitForMsg(ws);

    // Verify: health columns updated, sentinel untouched
    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const row = instance.ctx.storage.sql
        .exec(
          `SELECT healthy, status, last_error, agent_description FROM agents WHERE instance_uid = ?`,
          instanceUid,
        )
        .toArray()[0];
      expect(row!["healthy"]).toBe(0); // false → 0
      expect(row!["status"]).toBe("degraded");
      expect(row!["last_error"]).toBe("test-error");
      // Tier 1 targeted UPDATE should NOT overwrite agent_description
      expect(row!["agent_description"]).toBe('{"sentinel":"tier1-test"}');
    });

    ws.close();
  });

  it("agents table has no indexes (write cost optimization)", async () => {
    const doId = env.CONFIG_DO.idFromName("idx-test:idx-config");
    const stub = env.CONFIG_DO.get(doId);

    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const sql = instance.ctx.storage.sql;
      // Trigger schema initialization
      const { initSchema } = await import("../src/durable-objects/agent-state-repo.js");
      initSchema(sql);

      // Verify no indexes exist on agents table
      const indexes = sql
        .exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agents'`)
        .toArray();
      // Only the auto-generated PK index should exist
      const userIndexes = indexes.filter(
        (i) => !(i["name"] as string).startsWith("sqlite_autoindex"),
      );
      expect(userIndexes).toHaveLength(0);
    });
  });

  it("agents table has no rate_window columns", async () => {
    const doId = env.CONFIG_DO.idFromName("schema-test:schema-config");
    const stub = env.CONFIG_DO.get(doId);

    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const sql = instance.ctx.storage.sql;
      const { initSchema } = await import("../src/durable-objects/agent-state-repo.js");
      initSchema(sql);

      const cols = sql.exec(`PRAGMA table_info(agents)`).toArray();
      const colNames = cols.map((c) => c["name"] as string);
      expect(colNames).not.toContain("rate_window_start");
      expect(colNames).not.toContain("rate_window_count");
    });
  });

  it("many rapid messages do not cause connection closure (no rate limiter)", async () => {
    const tenant = await createTenant("Burst Corp");
    const config = await createConfig(tenant.id, "burst-config");
    const token = await createEnrollmentToken(config.id);
    const { ws } = await connectWithEnrollment(token.token);
    await sendHello(ws);

    // Send 100 heartbeats rapidly — should all be accepted (no rate limiter)
    for (let seq = 1; seq <= 100; seq++) {
      await sendHeartbeat(ws, seq);
    }

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("migration drops pre-existing indexes on agents table", async () => {
    const doId = env.CONFIG_DO.idFromName("migrate-idx:migrate-config");
    const stub = env.CONFIG_DO.get(doId);

    await runInDurableObject(stub, async (instance: ConfigDurableObject) => {
      const sql = instance.ctx.storage.sql;

      // Simulate a legacy DO that has indexes on the agents table
      sql.exec(`CREATE TABLE IF NOT EXISTS agents (
        instance_uid TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        sequence_num INTEGER NOT NULL DEFAULT 0,
        generation INTEGER NOT NULL DEFAULT 0,
        healthy INTEGER DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_error TEXT NOT NULL DEFAULT '',
        current_config_hash TEXT DEFAULT NULL,
        effective_config_hash TEXT DEFAULT NULL,
        last_seen_at INTEGER NOT NULL DEFAULT 0,
        connected_at INTEGER NOT NULL DEFAULT 0,
        agent_description TEXT DEFAULT NULL,
        capabilities INTEGER NOT NULL DEFAULT 0,
        component_health_map TEXT DEFAULT NULL,
        available_components TEXT DEFAULT NULL
      )`);
      // Create legacy indexes that should be dropped by migration
      sql.exec(`CREATE INDEX idx_agents_status ON agents(status)`);
      sql.exec(`CREATE INDEX idx_agents_last_seen ON agents(last_seen_at)`);
      sql.exec(`CREATE INDEX idx_agents_config_hash ON agents(current_config_hash)`);

      // Verify indexes exist before migration
      const beforeIndexes = sql
        .exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agents'`)
        .toArray()
        .filter((i) => !(i["name"] as string).startsWith("sqlite_autoindex"));
      expect(beforeIndexes.length).toBe(3);

      // Run migration via initSchema (which calls migrateSchema)
      const { initSchema } = await import("../src/durable-objects/agent-state-repo.js");
      initSchema(sql);

      // Verify indexes are dropped after migration
      const afterIndexes = sql
        .exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agents'`)
        .toArray()
        .filter((i) => !(i["name"] as string).startsWith("sqlite_autoindex"));
      expect(afterIndexes).toHaveLength(0);
    });
  });
});
