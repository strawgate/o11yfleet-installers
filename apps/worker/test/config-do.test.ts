import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { ConfigDurableObject } from "../src/durable-objects/config-do.js";
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
    const body = await response.json<{ agents: unknown[] }>();
    expect(body.agents).toHaveLength(0);
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
    await runInDurableObject(stub, async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
      const tables = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'")
        .toArray();
      expect(tables).toHaveLength(1);
    });
  });
});
