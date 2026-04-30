import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { runInDurableObject } from "cloudflare:test";

describe("Config Durable Object", () => {
  it("GET /stats returns initial stats", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-1");
    const stub = env.CONFIG_DO.get(id);
    const response = await stub.fetch("http://internal/stats");
    expect(response.status).toBe(200);
    const body = await response.json<{ total_agents: number }>();
    expect(body.total_agents).toBe(0);
  });

  it("GET /agents returns empty list initially", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-1");
    const stub = env.CONFIG_DO.get(id);
    const response = await stub.fetch("http://internal/agents");
    expect(response.status).toBe(200);
    const body = await response.json<{
      agents: unknown[];
      pagination: { has_more: boolean; next_cursor: string | null; sort: string };
    }>();
    expect(body.agents).toHaveLength(0);
    expect(body.pagination.has_more).toBe(false);
    expect(body.pagination.next_cursor).toBeNull();
    expect(body.pagination.sort).toBe("last_seen_desc");
  });

  it("GET /agents returns 400 on invalid cursor", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-invalid-cursor");
    const stub = env.CONFIG_DO.get(id);
    const response = await stub.fetch("http://internal/agents?cursor=bad");
    expect(response.status).toBe(400);
  });

  it("GET /agents/:instanceUid returns the inserted agent", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-agent-detail");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, agent_description, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "detail-agent-1",
          "tenant-1",
          "config-agent-detail",
          "connected",
          Date.now(),
          Date.now(),
          "host-detail-1",
          "hash-current-1",
        );
      },
    );

    const found = await stub.fetch("http://internal/agents/detail-agent-1");
    expect(found.status).toBe(200);
    const agent = await found.json<{
      instance_uid: string;
      status: string;
      agent_description: string;
      current_config_hash: string;
    }>();
    expect(agent.instance_uid).toBe("detail-agent-1");
    expect(agent.status).toBe("connected");
    expect(agent.agent_description).toBe("host-detail-1");
    expect(agent.current_config_hash).toBe("hash-current-1");

    const missing = await stub.fetch("http://internal/agents/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("GET /stats reports drift and status_counts without scanning agents", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-cohort-stats");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "desired-hash" }),
      headers: { "Content-Type": "application/json" },
    });

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        const inserts: Array<[string, string, string, number]> = [
          // [uid, status, current_hash, healthy]
          ["a1", "connected", "desired-hash", 1],
          ["a2", "connected", "stale-hash", 1],
          ["a3", "degraded", "stale-hash", 0],
          ["a4", "disconnected", "desired-hash", 1],
        ];
        for (const [uid, status, hash, healthy] of inserts) {
          state.storage.sql.exec(
            `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, current_config_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            uid,
            "tenant-1",
            "config-cohort-stats",
            status,
            healthy,
            now,
            now,
            hash,
          );
        }
      },
    );

    const statsRes = await stub.fetch("http://internal/stats");
    const stats = await statsRes.json<{
      total_agents: number;
      drifted_agents: number;
      status_counts: Record<string, number>;
      current_hash_counts: Array<{ value: string; count: number }>;
    }>();
    expect(stats.total_agents).toBe(4);
    expect(stats.drifted_agents).toBe(2);
    expect(stats.status_counts).toMatchObject({
      connected: 2,
      degraded: 1,
      disconnected: 1,
    });
    expect(stats.current_hash_counts).toEqual(
      expect.arrayContaining([
        { value: "desired-hash", count: 2 },
        { value: "stale-hash", count: 2 },
      ]),
    );
  });

  it("POST /command/set-desired-config stores hash", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-1");
    const stub = env.CONFIG_DO.get(id);

    const response = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "abc123" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ pushed: number; config_hash: string }>();
    expect(body.config_hash).toBe("abc123");
    expect(body.pushed).toBe(0); // No connected agents

    // Verify stats reflect the desired hash
    const statsRes = await stub.fetch("http://internal/stats");
    const stats = await statsRes.json<{ desired_config_hash: string }>();
    expect(stats.desired_config_hash).toBe("abc123");
  });

  it("POST /command/set-desired-config requires config_hash", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-1");
    const stub = env.CONFIG_DO.get(id);

    const response = await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("GET /unknown returns 404", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-1");
    const stub = env.CONFIG_DO.get(id);
    const response = await stub.fetch("http://internal/unknown");
    expect(response.status).toBe(404);
  });

  it("initializes SQLite agents table", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-init");
    const stub = env.CONFIG_DO.get(id);

    // Trigger initialization by fetching stats
    await stub.fetch("http://internal/stats");

    // Verify the table exists by using runInDurableObject
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const tables = state.storage.sql
          .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
          .toArray();
        expect(tables).toHaveLength(1);
      },
    );
  });

  it("stale sweep records aggregate stats in DO SQLite", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-sweep-stats");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
          "stale-agent-1",
          "tenant-1",
          "config-sweep-stats",
          "running",
          Date.now() - 4 * 60 * 60 * 1000,
          Date.now() - 4 * 60 * 60 * 1000,
        );
      },
    );

    const response = await stub.fetch("http://internal/command/sweep", {
      method: "POST",
      headers: {
        "x-fp-tenant-id": "tenant-1",
        "x-fp-config-id": "config-sweep-stats",
      },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ swept: number; active_websockets: number }>();
    expect(body.swept).toBe(1);
    expect(body.active_websockets).toBe(0);

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const row = state.storage.sql.exec(`SELECT * FROM do_config WHERE id = 1`).one();
        expect(row["last_sweep_at"]).toBeGreaterThan(0);
        expect(row["last_sweep_stale_count"]).toBe(1);
        expect(row["total_sweeps"]).toBe(1);
        expect(row["total_stale_swept"]).toBe(1);
        expect(row["sweeps_with_stale"]).toBe(1);
      },
    );
  });

  it("stale sweep skips agents that still have an active WebSocket", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-sweep-active");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
          "active-agent-1",
          "tenant-1",
          "config-sweep-active",
          "running",
          Date.now() - 4 * 60 * 60 * 1000,
          Date.now() - 4 * 60 * 60 * 1000,
        );

        const { sweepStaleAgents } = await import("../src/durable-objects/agent-state-repo.js");
        const swept = sweepStaleAgents(
          state.storage.sql,
          3 * 60 * 60 * 1000,
          new Set(["active-agent-1"]),
        );
        expect(swept).toHaveLength(0);

        const row = state.storage.sql
          .exec(`SELECT status FROM agents WHERE instance_uid = ?`, "active-agent-1")
          .one();
        expect(row["status"]).toBe("running");
      },
    );
  });

  it("rehydrates effective config bodies on the agents read path", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-agent-snapshots");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `INSERT INTO config_snapshots (hash, body) VALUES (?, ?)`,
          "snapshot-hash-1",
          "receivers:\n  otlp:\n",
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, effective_config_hash, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "snapshot-agent-1",
          "tenant-1",
          "config-agent-snapshots",
          "running",
          "snapshot-hash-1",
          Date.now(),
          Date.now(),
        );
      },
    );

    const response = await stub.fetch("http://internal/agents");
    expect(response.status).toBe(200);
    const body = await response.json<{ agents: Array<{ effective_config_body: string | null }> }>();
    expect(body.agents[0]?.effective_config_body).toBe("receivers:\n  otlp:\n");
  });

  it("migrates legacy pending events and writes created_at explicitly", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-pending-events-migration");
    const stub = env.CONFIG_DO.get(id);

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `CREATE TABLE pending_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT NOT NULL
          )`,
        );
        state.storage.sql.exec(`INSERT INTO pending_events (payload) VALUES (?)`, "{}");

        const { initSchema, bufferEvents } =
          await import("../src/durable-objects/agent-state-repo.js");
        initSchema(state.storage.sql);
        bufferEvents(state.storage.sql, [{ type: "test_event" }]);

        const columns = state.storage.sql.exec(`PRAGMA table_info(pending_events)`).toArray();
        expect(columns.some((c) => c["name"] === "created_at")).toBe(true);

        const rows = state.storage.sql
          .exec(`SELECT created_at FROM pending_events ORDER BY id`)
          .toArray();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => typeof r["created_at"] === "number")).toBe(true);
      },
    );
  });

  it("enforces the pending event hard cap on write", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-pending-events-cap");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const { bufferEvents, countPendingEvents } =
          await import("../src/durable-objects/agent-state-repo.js");
        bufferEvents(
          state.storage.sql,
          Array.from({ length: 10_050 }, (_, i) => ({ type: "test_event", i })),
        );

        expect(countPendingEvents(state.storage.sql)).toBe(10_000);
        const oldest = state.storage.sql
          .exec(`SELECT payload FROM pending_events ORDER BY id LIMIT 1`)
          .one()["payload"] as string;
        expect(JSON.parse(oldest)).toEqual({ type: "test_event", i: 50 });
      },
    );
  });

  it("drains buffered events in queue-safe chunks", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-queue-chunks");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const { bufferEvents, countPendingEvents } =
          await import("../src/durable-objects/agent-state-repo.js");
        bufferEvents(
          state.storage.sql,
          Array.from({ length: 250 }, (_, i) => ({ type: "test_event", i })),
        );

        const batchSizes: number[] = [];
        (
          instance as unknown as {
            env: {
              FP_EVENTS: {
                sendBatch: (messages: Array<{ body: unknown }>) => Promise<void>;
              };
            };
          }
        ).env.FP_EVENTS = {
          sendBatch: async (messages: Array<{ body: unknown }>) => {
            batchSizes.push(messages.length);
          },
        };

        await instance.alarm();

        expect(batchSizes).toEqual([100, 100, 50]);
        expect(countPendingEvents(state.storage.sql)).toBe(0);
      },
    );
  });
});
