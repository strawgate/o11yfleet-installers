import { env } from "cloudflare:workers";
import { describe, it, test, expect, beforeAll, beforeEach } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";
import { runInDurableObject } from "cloudflare:test";
import {
  bootstrapSchema,
  createTenant,
  createConfig,
  createEnrollmentToken,
  connectWithEnrollment,
  connectWithClaim,
  sendHello,
  waitForMsg,
  waitForClose,
  msgToBuffer,
  encodeFrame,
  decodeFrame,
  type AssignmentClaim,
  type ServerToAgent,
  createRuntimeTestContext,
} from "./helpers.js";
import { buildDisconnect } from "@o11yfleet/test-utils";
import { hexToUint8Array } from "@o11yfleet/core/hex";

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
      body: JSON.stringify({ config_hash: "deadbeef0001" }),
      headers: { "Content-Type": "application/json" },
    });

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        const inserts: Array<[string, string, string, number]> = [
          // [uid, status, current_hash, healthy]
          ["a1", "connected", "deadbeef0001", 1],
          ["a2", "connected", "deadbeef0002", 1],
          ["a3", "degraded", "deadbeef0002", 0],
          ["a4", "disconnected", "deadbeef0001", 1],
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
        { value: "deadbeef0001", count: 2 },
        { value: "deadbeef0002", count: 2 },
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

  it("DO fetch to unknown route returns 404", async () => {
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
          (uid) => uid === "active-agent-1",
        );
        expect(swept).toHaveLength(0);

        const row = state.storage.sql
          .exec(`SELECT status FROM agents WHERE instance_uid = ?`, "active-agent-1")
          .one();
        expect(row["status"]).toBe("running");
      },
    );
  });

  it("auto-unenroll deletes disconnected agents past policy TTL", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-auto-unenroll");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        // Set policy: auto-unenroll after 7 days
        state.storage.sql.exec(`UPDATE do_config SET auto_unenroll_after_days = 7 WHERE id = 1`);
        // Agent disconnected 10 days ago — should be purged
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "old-agent",
          "tenant-1",
          "config-auto-unenroll",
          "disconnected",
          Date.now() - 10 * 86_400_000,
          Date.now() - 10 * 86_400_000,
        );
        // Agent disconnected 3 days ago — should be kept
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "recent-agent",
          "tenant-1",
          "config-auto-unenroll",
          "disconnected",
          Date.now() - 3 * 86_400_000,
          Date.now() - 3 * 86_400_000,
        );
      },
    );

    const response = await stub.fetch("http://internal/command/sweep", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ unenrolled: number }>();
    expect(body.unenrolled).toBe(1);

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        // Old agent deleted
        const old = state.storage.sql
          .exec(`SELECT * FROM agents WHERE instance_uid = ?`, "old-agent")
          .toArray();
        expect(old).toHaveLength(0);
        // Recent agent still there
        const recent = state.storage.sql
          .exec(`SELECT * FROM agents WHERE instance_uid = ?`, "recent-agent")
          .toArray();
        expect(recent).toHaveLength(1);
      },
    );
  });

  it("auto-unenroll disabled when policy is null", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-unenroll-disabled");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        // Explicitly disable auto-unenroll
        state.storage.sql.exec(`UPDATE do_config SET auto_unenroll_after_days = NULL WHERE id = 1`);
        // Agent disconnected 60 days ago
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "ancient-agent",
          "tenant-1",
          "config-unenroll-disabled",
          "disconnected",
          Date.now() - 60 * 86_400_000,
          Date.now() - 60 * 86_400_000,
        );
      },
    );

    const response = await stub.fetch("http://internal/command/sweep", { method: "POST" });
    expect(response.status).toBe(200);
    const body = await response.json<{ unenrolled: number }>();
    expect(body.unenrolled).toBe(0);

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        // Agent still there because auto-unenroll is disabled
        const rows = state.storage.sql
          .exec(`SELECT * FROM agents WHERE instance_uid = ?`, "ancient-agent")
          .toArray();
        expect(rows).toHaveLength(1);
      },
    );
  });

  it("auto-unenroll never deletes connected or running agents", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-unenroll-safety");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(`UPDATE do_config SET auto_unenroll_after_days = 1 WHERE id = 1`);
        // Agent is old but status = 'running' (not disconnected)
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "running-agent",
          "tenant-1",
          "config-unenroll-safety",
          "running",
          Date.now() - 60 * 86_400_000,
          Date.now() - 60 * 86_400_000,
        );
        // Agent is old but status = 'connected'
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "connected-agent",
          "tenant-1",
          "config-unenroll-safety",
          "connected",
          Date.now() - 60 * 86_400_000,
          Date.now() - 60 * 86_400_000,
        );
      },
    );

    // First sweep: auto-unenroll runs before stale sweep, so 0 unenrolled.
    // Stale sweep then flips both agents to disconnected.
    const res1 = await stub.fetch("http://internal/command/sweep", { method: "POST" });
    expect(res1.status).toBe(200);
    const body1 = await res1.json<{ unenrolled: number; swept: number }>();
    expect(body1.unenrolled).toBe(0);

    // Second sweep (immediately after): agents are now disconnected but
    // last_seen_at is old enough to hit the cutoff. Auto-unenroll runs
    // BEFORE sweep so it sees them as disconnected and old — they ARE
    // eligible now. This is correct: they were already disconnected from
    // a prior sweep pass, not freshly flipped.
    const res2 = await stub.fetch("http://internal/command/sweep", { method: "POST" });
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ unenrolled: number }>();
    expect(body2.unenrolled).toBe(2);
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

// ─── isAgentConnected: O(1) tag-based lookup with enrollment fallback ───

beforeAll(() => bootstrapSchema());

describe("isAgentConnected via agent detail endpoint", () => {
  it("returns is_connected=true for an agent with an active WebSocket", async () => {
    const tenant = await createTenant("Connected Corp");
    const config = await createConfig(tenant.id, "connected-detail");
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);
    const uid = enrollment.instance_uid;

    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);
    const res = await stub.fetch(`http://internal/agents/${uid}`);
    expect(res.status).toBe(200);

    const detail = (await res.json()) as Record<string, unknown>;
    expect(detail.is_connected).toBe(true);

    ws.close();
  });

  it("returns is_connected=false after WebSocket closes", async () => {
    const tenant = await createTenant("Disconnected Corp");
    const config = await createConfig(tenant.id, "disconnected-detail");
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);
    const uid = enrollment.instance_uid;
    ws.close();

    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);
    let detail: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      const res = await stub.fetch(`http://internal/agents/${uid}`);
      expect(res.status).toBe(200);
      detail = (await res.json()) as Record<string, unknown>;
      if (detail.is_connected === false) break;
      await new Promise((r) => {
        setTimeout(r, 25);
      });
    }

    expect(detail.is_connected).toBe(false);
  });

  it("sweep skips agents found connected via isAgentConnected", async () => {
    const tenant = await createTenant("Sweep Skip Corp");
    const config = await createConfig(tenant.id, "sweep-skip-connected");
    const token = await createEnrollmentToken(config.id);

    const { ws } = await connectWithEnrollment(token.token);

    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);

    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `UPDATE agents SET last_seen_at = ? WHERE 1`,
          Date.now() - 4 * 60 * 60 * 1000,
        );
      },
    );

    const sweepRes = await stub.fetch("http://internal/command/sweep", { method: "POST" });
    expect(sweepRes.status).toBe(200);
    const sweep = await sweepRes.json<{ swept: number }>();
    expect(sweep.swept).toBe(0);

    ws.close();
  });
});

// ─── Duplicate UID detection via WebSocket tags ─────────────────────

describe("Duplicate UID detection", () => {
  it("assigns a new UID when a second connection shares the same instance_uid", async () => {
    const tenant = await createTenant("Dup Corp");
    const config = await createConfig(tenant.id, "dup-uid-detect");
    const token = await createEnrollmentToken(config.id);

    const { ws: wsEnroll, enrollment } = await connectWithEnrollment(token.token);
    const originalUid = enrollment.instance_uid;
    wsEnroll.close();

    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: tenant.id,
      config_id: config.id,
      instance_uid: originalUid,
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    };

    const ws1 = await connectWithClaim(claim);
    await sendHello(ws1);

    const ws2 = await connectWithClaim(claim);
    const dupResponse = await sendHello(ws2);

    expect(dupResponse.agent_identification).toBeDefined();
    expect(dupResponse.agent_identification!.new_instance_uid).toBeDefined();
    const newUidBytes = dupResponse.agent_identification!.new_instance_uid;
    expect(newUidBytes!.length).toBe(16);

    ws1.close();
    ws2.close();
  });

  it("does not count closed sockets as duplicates — only OPEN sockets matter", async () => {
    const tenant = await createTenant("Dup Corp");
    const config = await createConfig(tenant.id, "dup-uid-open-only");
    const token = await createEnrollmentToken(config.id);

    // First enrollment
    const { ws: wsEnroll, enrollment } = await connectWithEnrollment(token.token);
    const originalUid = enrollment.instance_uid;

    // Close this socket — it should NOT count as a duplicate
    wsEnroll.close();

    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: tenant.id,
      config_id: config.id,
      instance_uid: originalUid,
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    };

    // Connecting after enrollment socket closed should NOT trigger duplicate UID
    // because the enrollment socket is closed (not OPEN)
    const ws1 = await connectWithClaim(claim);
    const response1 = await sendHello(ws1);

    // Should NOT get a new_instance_uid — no duplicate detected
    expect(response1.agent_identification).toBeUndefined();
    expect(response1.instance_uid).toBeDefined();

    // Now connect a second OPEN socket with the same UID
    const ws2 = await connectWithClaim(claim);
    const dupResponse = await sendHello(ws2);

    // NOW duplicate should be detected (two OPEN sockets)
    expect(dupResponse.agent_identification).toBeDefined();
    expect(dupResponse.agent_identification!.new_instance_uid).toBeDefined();

    ws1.close();
    ws2.close();
  });
});

// ─── webSocketError defensive attachment parse ──────────────────────

describe("webSocketError defensive attachment parse", () => {
  it("does not crash when ws.deserializeAttachment throws", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-ws-error-bad-attach");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, _state) => {
        const badWs = {
          deserializeAttachment: () => {
            throw new Error("corrupt state");
          },
          close: () => {},
        } as unknown as WebSocket;

        await instance.webSocketError(badWs, new Error("network failure"));
      },
    );

    const statsRes = await stub.fetch("http://internal/stats");
    expect(statsRes.status).toBe(200);
  });

  it("handles error normally when attachment is valid", async () => {
    const id = env.CONFIG_DO.idFromName("tenant-1:config-ws-error-valid-attach");
    const stub = env.CONFIG_DO.get(id);
    await stub.fetch("http://internal/stats");

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "00000000000000000000000000000001",
          "tenant-1",
          "config-ws-error-valid-attach",
          "connected",
          Date.now(),
          Date.now(),
        );

        const attachment = {
          tenant_id: "tenant-1",
          config_id: "config-ws-error-valid-attach",
          instance_uid: "00000000000000000000000000000001",
          connected_at: Date.now(),
          sequence_num: 5,
          last_seen_at: Date.now(),
        };
        const mockWs = {
          deserializeAttachment: () => attachment,
          close: () => {},
        } as unknown as WebSocket;

        await instance.webSocketError(mockWs, new Error("transport error"));

        const row = state.storage.sql
          .exec(
            `SELECT status FROM agents WHERE instance_uid = ?`,
            "00000000000000000000000000000001",
          )
          .one();
        expect(row["status"]).toBe("disconnected");
      },
    );
  });
});

describe("Fleet Component Inventory", () => {
  let doRef: ConfigDO;
  const tenantId = "test-tenant";
  const configId = "test-config";

  beforeEach(async () => {
    const setup = await createRuntimeTestContext();
    doRef = setup.durableObject;
  });

  test("getFleetComponentInventory returns agents grouped by component fingerprint", async () => {
    await doRef.fetch("http://internal/stats");

    // Insert test agents with different available_components
    await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "agent-1",
          tenantId,
          configId,
          "connected",
          now,
          now,
          JSON.stringify({
            components: {
              receivers: { sub_component_map: { otlp: {} } },
              processors: { sub_component_map: {} },
              exporters: { sub_component_map: {} },
              extensions: { sub_component_map: {} },
              connectors: { sub_component_map: {} },
            },
          }),
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "agent-2",
          tenantId,
          configId,
          "connected",
          now,
          now,
          JSON.stringify({
            components: {
              receivers: { sub_component_map: { otlp: {} } },
              processors: { sub_component_map: {} },
              exporters: { sub_component_map: {} },
              extensions: { sub_component_map: {} },
              connectors: { sub_component_map: {} },
            },
          }),
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "agent-3",
          tenantId,
          configId,
          "connected",
          now,
          now,
          JSON.stringify({
            components: {
              receivers: { sub_component_map: { otlp: {}, prometheus: {} } },
              processors: { sub_component_map: {} },
              exporters: { sub_component_map: {} },
              extensions: { sub_component_map: {} },
              connectors: { sub_component_map: {} },
            },
          }),
        );
      },
    );

    const groups = await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const { getFleetComponentInventory } =
          await import("../src/durable-objects/agent-state-repo.js");
        return getFleetComponentInventory(state.storage.sql, tenantId, configId);
      },
    );

    expect(groups).toHaveLength(2);
    const sorted = [...groups].sort((a, b) => b.agentCount - a.agentCount);
    expect(sorted[0]!.agentCount).toBe(2);
    expect(sorted[0]!.agentUids).toContain("agent-1");
    expect(sorted[0]!.agentUids).toContain("agent-2");
    expect(sorted[1]!.agentCount).toBe(1);
    expect(sorted[1]!.agentUids).toContain("agent-3");
  });

  test("getFleetComponentInventory handles agents with null available_components", async () => {
    await doRef.fetch("http://internal/stats");

    await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "agent-1",
          tenantId,
          configId,
          "connected",
          now,
          now,
          null,
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, last_seen_at, connected_at, available_components)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          "agent-2",
          tenantId,
          configId,
          "connected",
          now,
          now,
          null,
        );
      },
    );

    const groups = await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const { getFleetComponentInventory } =
          await import("../src/durable-objects/agent-state-repo.js");
        return getFleetComponentInventory(state.storage.sql, tenantId, configId);
      },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.agentCount).toBe(2);
    expect(groups[0]!.availableComponents).toBe("null");
  });
});

// ─── agent_disconnect clears connected_at ─────────────────────────────────

describe("agent_disconnect clears connected_at in persisted row", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("connected_at is set to 0 in SQLite after agent_disconnect frame", async () => {
    const tenant = await createTenant("Disconnect Test Corp");
    const config = await createConfig(tenant.id, "disconnect-test");
    const token = await createEnrollmentToken(config.id);

    // Enroll and connect agent
    const { ws, enrollment } = await connectWithEnrollment(token.token);

    // Wait a moment so connected_at is definitely set to a non-zero value
    await new Promise((r) => {
      setTimeout(r, 50);
    });

    // Send agent_disconnect frame. Use sequenceNum=1 (next-expected after the
    // enrollment hello at seq=0) so the state-machine doesn't drop it as a
    // sequence-gap report-full-state.
    ws.send(
      encodeFrame(
        buildDisconnect({
          instanceUid: hexToUint8Array(enrollment.instance_uid),
          sequenceNum: 1,
        }),
      ),
    );

    // Wait for the disconnect to be processed
    await new Promise((r) => {
      setTimeout(r, 50);
    });

    // Query the database directly
    const id = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(id);
    await runInDurableObject(
      stub,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const row = state.storage.sql
          .exec(
            `SELECT status, connected_at FROM agents WHERE instance_uid = ?`,
            enrollment.instance_uid,
          )
          .one();
        expect(row["status"]).toBe("disconnected");
        // connected_at should be 0 after disconnect (was set to a non-zero value on connect)
        expect(Number(row["connected_at"])).toBe(0);
      },
    );

    ws.close();
  });
});

// ─── duplicate UID socket closed ─────────────────────────────────────────

describe("duplicate-UID detection closes the socket", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("duplicate-UID response closes the socket so agent reconnects with new UID", async () => {
    const tenant = await createTenant("Dup Close Corp");
    const config = await createConfig(tenant.id, "dup-close-test");
    const token = await createEnrollmentToken(config.id);

    // First enrollment — keep ws1 OPEN so the dup-detect tag lookup
    // sees two OPEN sockets sharing the same do_assigned_uid.
    const { ws: ws1, enrollment } = await connectWithEnrollment(token.token);
    const originalUid = enrollment.instance_uid;
    const originalUidBytes = hexToUint8Array(originalUid);

    // Create a claim with the same UID so ws2 is tagged identically.
    const claim: AssignmentClaim = {
      v: 1,
      tenant_id: tenant.id,
      config_id: config.id,
      instance_uid: originalUid,
      generation: 1,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    };

    // Second connection with the same UID. The dup-detect branch in
    // ConfigDurableObject.webSocketMessage only fires on
    // `sequence_num === 0` (see config-do.ts ~line 586). Drive the
    // test through that branch by sending a frame with seq_num=0 —
    // hello is the natural OpAMP first frame, but any seq=0 frame
    // works. Using buildDisconnect with sequenceNum: 0 here keeps
    // the test focused on "second-frame on same UID with seq 0
    // → dup-detect close" without conflating the assertion with
    // the agent_disconnect handler (dup-detect runs first and
    // returns early at config-do.ts ~line 632).
    //
    // PRIOR BUG: this test used buildDisconnect's default
    // sequenceNum=99 and never drove the dup-detect branch — the
    // disconnect path closed the socket for an unrelated reason and
    // the assertion `ws2.readyState === CLOSED` passed for the wrong
    // reason. See issue strawgate/o11yfleet#731.
    const ws2 = await connectWithClaim(claim);
    ws2.send(encodeFrame(buildDisconnect({ instanceUid: originalUidBytes, sequenceNum: 0 })));

    // Capture the dup-rejection frame. Per OpAMP spec §3.2.1.2 the
    // server tells the duplicate connection to adopt a new UID via
    // agent_identification.new_instance_uid (16 random bytes).
    const dupMsgEvent = await waitForMsg(ws2);
    const dupBuf = await msgToBuffer(dupMsgEvent);
    const dupResponse = decodeFrame<ServerToAgent>(dupBuf);

    expect(dupResponse.agent_identification).toBeDefined();
    expect(dupResponse.agent_identification!.new_instance_uid).toBeDefined();
    const newUidBytes = dupResponse.agent_identification!.new_instance_uid!;
    expect(newUidBytes.length).toBe(16);
    // The response's outer instance_uid must match the new UID so a
    // strict OpAMP client correlates the rename with the frame.
    expect(dupResponse.instance_uid).toBeDefined();
    expect(Array.from(dupResponse.instance_uid!)).toEqual(Array.from(newUidBytes));
    // The new UID must differ from the original so the reconnect
    // actually escapes the duplicate condition.
    expect(Array.from(newUidBytes)).not.toEqual(Array.from(originalUidBytes));

    // Now wait for the close that follows the rename frame. The DO
    // calls ws.close(1000, "Reconnect with new instance_uid") at
    // config-do.ts ~line 630 — both code AND reason are part of the
    // contract: opamp-go logs the reason at info level and clients
    // use the 1000 (NormalClosure) code to distinguish a managed
    // rename from a transport error. Asserting on both prevents a
    // future refactor from silently changing the wire-level signal.
    const closeEvent = await waitForClose(ws2);
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe("Reconnect with new instance_uid");
    expect(ws2.readyState).toBe(WebSocket.CLOSED);

    ws1.close();
  });
});

// ─── saveAgentState end-to-end SQL round-trip ────────────────────────
//
// Regression for a class of bug where the saveAgentState UPSERT in
// agent-state-repo.ts contained `//` line-comments inside a SQL
// string — SQLite's parser doesn't accept `//` (only `--` / `/* */`),
// so the statement raised `near "/": syntax error` at runtime. The
// bug survived merge because every other test that mentioned the
// agents table either inserted via raw SQL (skipping saveAgentState
// entirely) or only exercised paths that didn't hit the Tier-2
// UPSERT. This test drives a real enrollment + hello flow (the
// canonical Tier-2 path: `forceFullPersist=true` on the first
// message in config-do.ts ~line 750) and then reads the row back
// from DO-local SQLite. Any future syntax error in saveAgentState's
// SQL — comments, missing column, broken ON CONFLICT clause — will
// cause the row to be missing and `.one()` to throw "no results."

describe("saveAgentState end-to-end SQL round-trip", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("writes a row to DO SQLite when the hello path executes Tier-2 UPSERT", async () => {
    const tenant = await createTenant("Save State Corp");
    const config = await createConfig(tenant.id, "save-state-config");
    const token = await createEnrollmentToken(config.id);

    // The whole assertion runs inside `doAction` so it executes
    // while the DO is awake (right after the reconnect hello
    // completes). After connectWithEnrollment returns, the WS may
    // be closed by hibernation in the test pool, which would flip
    // status to "disconnected" via webSocketClose → markDisconnected
    // and mask the very write we're trying to verify. Reading inside
    // the doAction window keeps the test focused on saveAgentState.
    let observed: Record<string, unknown> | null = null;
    const { ws } = await connectWithEnrollment(token.token, {
      doAction: async (uid, doStub) => {
        await runInDurableObject(
          doStub,
          async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
            // Deliberately SELECT every column saveAgentState writes
            // — if the UPSERT raised, .one() throws "no results" and
            // the test fails loudly with the column list intact for
            // diff context.
            observed = state.storage.sql
              .exec(
                `SELECT instance_uid, tenant_id, config_id, sequence_num, generation, status, connected_at, last_seen_at, capabilities, agent_description
                 FROM agents WHERE instance_uid = ?`,
                uid,
              )
              .one();
          },
        );
      },
    });

    expect(observed).not.toBeNull();
    const row = observed!;
    // Identity columns reflect the values the DO assigned at accept
    // time. tenant_id / config_id come from the WS attachment, not
    // the agent frame — proves the UPSERT used the right binding
    // order on the bind list (a swapped binding here would make
    // these mismatch).
    expect(row["tenant_id"]).toBe(tenant.id);
    expect(row["config_id"]).toBe(config.id);
    // generation is bumped on first connect (config-do.ts ~line
    // 659). Non-zero is enough — the exact value depends on whether
    // the DO had a prior session.
    expect(Number(row["generation"])).toBeGreaterThanOrEqual(1);
    // The `status` column stores the agent-reported health status
    // (e.g. StatusOK), NOT a connection-state enum — the state
    // machine writes msg.health.status here per state-machine
    // processor.ts ~line 192. buildHello defaults healthStatus to
    // "StatusOK", and the only other observable value on this path
    // is "disconnected" (set when agent_disconnect runs). Asserting
    // "StatusOK" pins the round-trip: the row was written by the
    // hello path and not later mutated by a disconnect.
    expect(row["status"]).toBe("StatusOK");
    // connected_at must be a fresh non-zero timestamp. The fix for
    // #708 dropped the old CASE clause that incorrectly overrode
    // the state-machine value — guard against that regression by
    // asserting the value is in the recent past.
    const connectedAt = Number(row["connected_at"]);
    expect(connectedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(connectedAt).toBeLessThanOrEqual(Date.now());
    // capabilities was bound from the agent's hello frame and
    // buildHello defaults to a non-zero capability mask
    // (CONFIGURABLE_CAPABILITIES).
    expect(Number(row["capabilities"])).toBeGreaterThan(0);
    // agent_description is JSON-encoded by saveAgentState; it must
    // be a non-empty string for /agents to surface anything useful.
    expect(typeof row["agent_description"]).toBe("string");
    expect((row["agent_description"] as string).length).toBeGreaterThan(0);

    ws.close();
  });
});

// ─── computeMetricsSql ↔ computeConfigMetrics parity ─────────────────
//
// Regression for a semantic-drift bug where computeMetricsSql counted
// every agent as `config_up_to_date` when no desired hash was set,
// while the JS path computeConfigMetrics (packages/core/src/metrics
// /index.ts ~line 75-79, added in #712) only counts CONNECTED agents
// in that case. The two metric paths feed the same dashboards via
// different code paths (DO-aggregated SQL vs. portal-aggregated JS),
// so a divergence here surfaces as flapping numbers depending on
// which code path the caller hits. This test pins the contract: for
// a fleet of one connected + one disconnected agent with NO desired
// hash, both implementations must report config_up_to_date == 1.

describe("computeMetricsSql ↔ computeConfigMetrics parity", () => {
  beforeAll(async () => {
    await bootstrapSchema();
  });

  it("agrees on config_up_to_date for connected+disconnected with no desired hash", async () => {
    const { durableObject: doRef } = await createRuntimeTestContext();
    const tenantId = "metrics-parity-tenant";
    const configId = "metrics-parity-config";

    // Seed two agents: one connected, one disconnected. The desired
    // config hash is NULL so the no-desired-hash branch in both
    // computeMetricsSql and computeConfigMetrics is exercised.
    await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "metrics-agent-connected",
          tenantId,
          configId,
          "connected",
          1,
          now,
          now,
          null,
        );
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "metrics-agent-disconnected",
          tenantId,
          configId,
          "disconnected",
          1,
          now,
          0,
          null,
        );
        // A third agent in the default "unknown" state (created but
        // never reported). Both paths must agree it does NOT count
        // toward config_up_to_date — only `status === "connected"`
        // does in the no-desired-hash branch. This guards against a
        // future drift where someone broadens the SQL predicate to
        // `status != 'disconnected'` (which would match `unknown`)
        // without updating the JS path to match.
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "metrics-agent-unknown",
          tenantId,
          configId,
          "unknown",
          1,
          now,
          0,
          null,
        );
        // A fourth agent with a hypothetical active non-connected
        // status ("running") AND a recent connected_at. The strict
        // semantic excludes it; a broader `status != 'disconnected' AND
        // connected_at > 0` predicate would accidentally count it. The
        // unknown agent above (connected_at=0) wouldn't catch that
        // specific drift — this one does.
        state.storage.sql.exec(
          `INSERT INTO agents (instance_uid, tenant_id, config_id, status, healthy, last_seen_at, connected_at, current_config_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          "metrics-agent-running",
          tenantId,
          configId,
          "running",
          1,
          now,
          now,
          null,
        );
      },
    );

    const { sqlMetrics, jsMetrics } = await runInDurableObject(
      doRef,
      async (_instance: InstanceType<typeof ConfigDurableObject>, state) => {
        const { computeMetricsSql } = await import("../src/durable-objects/agent-state-repo.js");
        const { computeConfigMetrics } = await import("@o11yfleet/core/metrics");
        const STALE_MS = 60_000;
        const sql = computeMetricsSql(state.storage.sql, null, STALE_MS);
        // Materialise the same row set the JS path consumes by
        // reading every agent and feeding them through
        // computeConfigMetrics. Pass null for desiredConfigHash so
        // both paths take the same branch.
        const rows = state.storage.sql
          .exec(
            `SELECT instance_uid, status, healthy, capabilities, current_config_hash, last_error, last_seen_at FROM agents`,
          )
          .toArray();
        const agentMap = new Map<
          string,
          {
            status: string;
            healthy: number;
            capabilities: number;
            current_config_hash: string | null;
            last_error: string;
            last_seen_at: number;
          }
        >();
        for (const r of rows) {
          agentMap.set(String(r["instance_uid"]), {
            status: String(r["status"] ?? ""),
            healthy: Number(r["healthy"] ?? 0),
            capabilities: Number(r["capabilities"] ?? 0),
            current_config_hash: r["current_config_hash"] ? String(r["current_config_hash"]) : null,
            last_error: String(r["last_error"] ?? ""),
            last_seen_at: Number(r["last_seen_at"] ?? 0),
          });
        }
        const js = computeConfigMetrics(agentMap, null);
        return { sqlMetrics: sql, jsMetrics: js };
      },
    );

    // The contract: only the connected agent counts as up-to-date
    // when there is no desired hash. Both paths must agree.
    expect(sqlMetrics.config_up_to_date).toBe(1);
    expect(jsMetrics.config_up_to_date).toBe(1);
    expect(sqlMetrics.config_up_to_date).toBe(jsMetrics.config_up_to_date);
  });
});
