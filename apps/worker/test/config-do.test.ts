import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { runInDurableObject } from "cloudflare:test";

describe("Config Durable Object", () => {
  it("GET /stats returns initial stats", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-stats");
    const stub = env.CONFIG_DO.get(id);
    const response = await stub.fetch("http://internal/stats");
    expect(response.status).toBe(200);
    const body = await response.json<{ total_agents: number }>();
    expect(body.total_agents).toBe(0);
  });

  it("GET /agents returns empty list initially", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-agents");
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
        // agent_description is stored as a JSON-encoded OpAMP-style descriptor
        // and the read path JSON.parses it; insert the same shape so the round
        // trip works under the current contract.
        const description = JSON.stringify({
          identifying_attributes: [{ key: "host.name", value: { string_value: "host-detail-1" } }],
        });
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, agent_description, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "detail-agent-1",
          "tenant-1",
          "config-agent-detail",
          "connected",
          Date.now(),
          Date.now(),
          description,
          "hash-current-1",
        );
      },
    );

    const found = await stub.fetch("http://internal/agents/detail-agent-1");
    expect(found.status).toBe(200);
    const agent = await found.json<{
      instance_uid: string;
      status: string;
      agent_description: {
        identifying_attributes?: Array<{ key: string; value?: { string_value?: string } }>;
      };
      current_config_hash: string;
    }>();
    expect(agent.instance_uid).toBe("detail-agent-1");
    expect(agent.status).toBe("connected");
    expect(agent.agent_description?.identifying_attributes?.[0]?.value?.string_value).toBe(
      "host-detail-1",
    );
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
    const id = env.CONFIG_DO.idFromName("tenant-1:config-desired");
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

    // Identity comes from ctx.id.name, persisted by ensureInit on first
    // wake — not from x-fp-* headers.
    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const row = state.storage.sql.exec(`SELECT tenant_id, config_id FROM do_config`).one();
        expect(row["tenant_id"]).toBe("tenant-1");
        expect(row["config_id"]).toBe("config-desired");
      },
    );
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
        expect(row["tenant_id"]).toBe("tenant-1");
        expect(row["config_id"]).toBe("config-sweep-stats");
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

  it("rehydrates effective config bodies on the agent detail path", async () => {
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

    // Single-agent detail includes the config body
    const response = await stub.fetch("http://internal/agents/snapshot-agent-1");
    expect(response.status).toBe(200);
    const agent = await response.json<{ effective_config_body: string | null }>();
    expect(agent.effective_config_body).toBe("receivers:\n  otlp:\n");
  });

  it("paginates agents with cursor round-trip", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-pagination");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        for (let i = 0; i < 5; i++) {
          state.storage.sql.exec(
            `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            `page-agent-${i}`,
            "tenant-1",
            "config-pagination",
            "connected",
            now - i * 1000,
            now,
          );
        }
      },
    );

    // First page: limit=2 (default sort = last_seen_desc)
    const page1Res = await stub.fetch("http://internal/agents?limit=2");
    expect(page1Res.status).toBe(200);
    const page1 = await page1Res.json<{
      agents: Array<{ instance_uid: string }>;
      pagination: { has_more: boolean; next_cursor: string | null; limit: number };
    }>();
    expect(page1.agents).toHaveLength(2);
    expect(page1.pagination.has_more).toBe(true);
    expect(page1.pagination.next_cursor).not.toBeNull();

    // Second page using cursor
    const page2Res = await stub.fetch(
      `http://internal/agents?limit=2&cursor=${page1.pagination.next_cursor}`,
    );
    const page2 = await page2Res.json<{
      agents: Array<{ instance_uid: string }>;
      pagination: { has_more: boolean; next_cursor: string | null };
    }>();
    expect(page2.agents).toHaveLength(2);
    expect(page2.pagination.has_more).toBe(true);

    // No overlap between pages
    const page1Uids = new Set(page1.agents.map((a) => a.instance_uid));
    for (const agent of page2.agents) {
      expect(page1Uids.has(agent.instance_uid)).toBe(false);
    }

    // Third page: only 1 left
    const page3Res = await stub.fetch(
      `http://internal/agents?limit=2&cursor=${page2.pagination.next_cursor}`,
    );
    const page3 = await page3Res.json<{
      agents: Array<{ instance_uid: string }>;
      pagination: { has_more: boolean; next_cursor: string | null };
    }>();
    expect(page3.agents).toHaveLength(1);
    expect(page3.pagination.has_more).toBe(false);
    expect(page3.pagination.next_cursor).toBeNull();
  });

  it("filters agents by status", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-filter-status");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        const agents = [
          ["filter-a1", "connected"],
          ["filter-a2", "connected"],
          ["filter-a3", "disconnected"],
        ] as const;
        for (const [uid, status] of agents) {
          state.storage.sql.exec(
            `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            uid,
            "tenant-1",
            "config-filter-status",
            status,
            now,
            now,
          );
        }
      },
    );

    const res = await stub.fetch("http://internal/agents?status=connected");
    const body = await res.json<{ agents: Array<{ instance_uid: string; status: string }> }>();
    expect(body.agents).toHaveLength(2);
    for (const a of body.agents) {
      expect(a.status).toBe("connected");
    }
  });

  it("filters agents by health", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-filter-health");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "healthy-1",
          "tenant-1",
          "config-filter-health",
          "connected",
          1,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "unhealthy-1",
          "tenant-1",
          "config-filter-health",
          "connected",
          0,
          now,
          now,
        );
      },
    );

    const healthyRes = await stub.fetch("http://internal/agents?health=healthy");
    const healthy = await healthyRes.json<{
      agents: Array<{ instance_uid: string; healthy: boolean }>;
    }>();
    expect(healthy.agents).toHaveLength(1);
    expect(healthy.agents[0]!.instance_uid).toBe("healthy-1");

    const unhealthyRes = await stub.fetch("http://internal/agents?health=unhealthy");
    const unhealthy = await unhealthyRes.json<{
      agents: Array<{ instance_uid: string; healthy: boolean }>;
    }>();
    expect(unhealthy.agents).toHaveLength(1);
    expect(unhealthy.agents[0]!.instance_uid).toBe("unhealthy-1");
  });

  it("searches agents by instance_uid substring", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-search");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        for (const uid of ["prod-collector-1", "prod-collector-2", "staging-monitor-1"]) {
          state.storage.sql.exec(
            `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            uid,
            "tenant-1",
            "config-search",
            "connected",
            now,
            now,
          );
        }
      },
    );

    const res = await stub.fetch("http://internal/agents?q=collector");
    const body = await res.json<{ agents: Array<{ instance_uid: string }> }>();
    expect(body.agents).toHaveLength(2);
    for (const a of body.agents) {
      expect(a.instance_uid).toContain("collector");
    }
  });

  it("sorts agents by instance_uid_asc", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-sort-uid");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        for (const uid of ["charlie", "alice", "bob"]) {
          state.storage.sql.exec(
            `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            uid,
            "tenant-1",
            "config-sort-uid",
            "connected",
            now,
            now,
          );
        }
      },
    );

    const res = await stub.fetch("http://internal/agents?sort=instance_uid_asc");
    const body = await res.json<{ agents: Array<{ instance_uid: string }> }>();
    expect(body.agents.map((a) => a.instance_uid)).toEqual(["alice", "bob", "charlie"]);
  });
});
