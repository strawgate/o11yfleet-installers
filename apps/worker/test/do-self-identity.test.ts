// Tests for the DO's self-identity model:
//   - identity is derived from `ctx.id.name`, not from headers or body
//   - /init persists identity + optional policy
//   - /sync-policy refreshes policy without disturbing identity
//   - body claims of tenant_id/config_id are ignored (no trust boundary)

import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ConfigDurableObject } from "../src/durable-objects/config-do.js";

function stubFor(name: string) {
  return env.CONFIG_DO.get(env.CONFIG_DO.idFromName(name));
}

describe("DO self-identity (Phase 1)", () => {
  it("/init persists identity from ctx.id.name with no body", async () => {
    const stub = stubFor("tenant-alpha:config-x");
    const resp = await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    expect(resp.status).toBe(200);
    const body = await resp.json<{
      tenant_id: string;
      config_id: string;
      policy: { max_agents_per_config: number | null };
      initialized: boolean;
    }>();
    expect(body.tenant_id).toBe("tenant-alpha");
    expect(body.config_id).toBe("config-x");
    expect(body.policy.max_agents_per_config).toBeNull();
    expect(body.initialized).toBe(true);
  });

  it("/init with body persists policy", async () => {
    const stub = stubFor("tenant-beta:config-y");
    const resp = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 250 }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json<{
      policy: { max_agents_per_config: number };
    }>();
    expect(body.policy.max_agents_per_config).toBe(250);
  });

  it("/init parses the special pending DO name correctly", async () => {
    const stub = stubFor("tenant-gamma:__pending__");
    const resp = await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const body = await resp.json<{ tenant_id: string; config_id: string }>();
    expect(body.tenant_id).toBe("tenant-gamma");
    expect(body.config_id).toBe("__pending__");
  });

  it("/init ignores tenant_id/config_id passed in body (no body-trust)", async () => {
    const stub = stubFor("tenant-real:config-real");
    const resp = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: "tenant-evil",
          config_id: "config-evil",
        }),
      }),
    );
    const body = await resp.json<{ tenant_id: string; config_id: string }>();
    expect(body.tenant_id).toBe("tenant-real");
    expect(body.config_id).toBe("config-real");

    // Verify the persisted identity also matches ctx.id.name, not the body claim.
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        const row = state.storage.sql
          .exec(`SELECT tenant_id, config_id FROM do_config WHERE id = 1`)
          .one();
        expect(row["tenant_id"]).toBe("tenant-real");
        expect(row["config_id"]).toBe("config-real");
      },
    );
  });

  it("/sync-policy updates policy without disturbing identity", async () => {
    const stub = stubFor("tenant-delta:config-z");
    await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 100 }),
      }),
    );

    const sync = await stub.fetch(
      new Request("http://internal/sync-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 500 }),
      }),
    );
    expect(sync.status).toBe(200);
    const syncBody = await sync.json<{ policy: { max_agents_per_config: number } }>();
    expect(syncBody.policy.max_agents_per_config).toBe(500);

    // Identity unchanged.
    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        const row = state.storage.sql
          .exec(`SELECT tenant_id, config_id FROM do_config WHERE id = 1`)
          .one();
        expect(row["tenant_id"]).toBe("tenant-delta");
        expect(row["config_id"]).toBe("config-z");
      },
    );
  });

  it("/init is idempotent — replay refreshes policy, identity unchanged", async () => {
    const stub = stubFor("tenant-eps:config-w");
    const first = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 50 }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 75 }),
      }),
    );
    expect(second.status).toBe(200);
    const body = await second.json<{
      tenant_id: string;
      config_id: string;
      policy: { max_agents_per_config: number };
    }>();
    expect(body.tenant_id).toBe("tenant-eps");
    expect(body.config_id).toBe("config-w");
    expect(body.policy.max_agents_per_config).toBe(75);
  });

  it("/init returns 400 for malformed JSON body", async () => {
    const stub = stubFor("tenant-bad:config-bad");
    const resp = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(resp.status).toBe(400);
    const body = await resp.json<{ error: string; field: string; reason: string }>();
    expect(body.field).toBe("body");
    expect(body.reason).toBe("invalid_json");
  });

  it("/init rejects a negative max_agents_per_config with a structured 400", async () => {
    const stub = stubFor("tenant-neg:config-neg");
    const resp = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: -10 }),
      }),
    );
    expect(resp.status).toBe(400);
    const body = await resp.json<{ field: string }>();
    expect(body.field).toBe("max_agents_per_config");
  });

  it("/init rejects a string posing as a number", async () => {
    const stub = stubFor("tenant-str:config-str");
    const resp = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: "100" }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  it("/init with explicit null clears the cap", async () => {
    const stub = stubFor("tenant-null:config-null");
    await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 200 }),
      }),
    );
    const cleared = await stub.fetch(
      new Request("http://internal/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: null }),
      }),
    );
    const body = await cleared.json<{ policy: { max_agents_per_config: number | null } }>();
    expect(body.policy.max_agents_per_config).toBeNull();
  });

  it("/sync-policy rejects malformed JSON with a structured 400", async () => {
    const stub = stubFor("tenant-sync-bad:config-sync-bad");
    await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const resp = await stub.fetch(
      new Request("http://internal/sync-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );
    expect(resp.status).toBe(400);
  });

  it("/sync-policy on an un-init'd DO still works (writes policy, identity stays empty)", async () => {
    const stub = stubFor("tenant-noinit:config-noinit");
    const resp = await stub.fetch(
      new Request("http://internal/sync-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_agents_per_config: 50 }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json<{ policy: { max_agents_per_config: number } }>();
    expect(body.policy.max_agents_per_config).toBe(50);
  });

  it("/init parses DO names with multiple colons (config_id can contain colons)", async () => {
    const stub = stubFor("tenant-multi:cfg:with:colons");
    const resp = await stub.fetch(new Request("http://internal/init", { method: "POST" }));
    const body = await resp.json<{ tenant_id: string; config_id: string }>();
    expect(body.tenant_id).toBe("tenant-multi");
    expect(body.config_id).toBe("cfg:with:colons");
  });

  it("/pending-devices works on a fresh __pending__ DO without prior /init", async () => {
    // Regression: isPendingDo must derive from ctx.id.name, not from
    // persisted SQL identity. A brand-new __pending__ DO has no rows in
    // do_config yet, so loadDoIdentity()-based routing would 404 here.
    const stub = stubFor("tenant-fresh:__pending__");
    const resp = await stub.fetch(
      new Request("http://internal/pending-devices", { method: "GET" }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json<{ devices: unknown[] }>();
    expect(body.devices).toEqual([]);
  });

  it("upsertPendingDevice handles ON CONFLICT (second hello from same uid)", async () => {
    // Regression: the helper had 13 SQL placeholders but only 12 bound
    // params, which made the SQLite engine reject every call —
    // including the conflict path that fires on every second WS hello
    // from a still-pending agent.
    const stub = stubFor("tenant-conflict:__pending__");
    await stub.fetch(new Request("http://internal/pending-devices", { method: "GET" }));

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        const { upsertPendingDevice } = await import("../src/durable-objects/agent-state-repo.js");
        // First insert — exercises the INSERT branch.
        upsertPendingDevice(state.storage.sql, {
          instance_uid: "uid-conflict",
          tenant_id: "tenant-conflict",
        });
        // Second insert with the same uid — exercises ON CONFLICT.
        upsertPendingDevice(state.storage.sql, {
          instance_uid: "uid-conflict",
          tenant_id: "tenant-conflict",
          display_name: "fleet-host-1",
        });
        const row = state.storage.sql
          .exec(`SELECT display_name FROM pending_devices WHERE instance_uid = ?`, "uid-conflict")
          .toArray()[0]!;
        expect(row["display_name"]).toBe("fleet-host-1");
      },
    );
  });

  it("/pending-devices/{uid}/assign keeps the assignment row alive for reconnect", async () => {
    // Regression: deletePendingDevice used to drop pending_assignments too,
    // which destroyed the assignment row immediately after writing it.
    // The reconnect-consume path then never saw the assignment and the
    // agent stayed stuck. After the fix, deletePendingDevice only drops
    // pending_devices; pending_assignments survives until the agent
    // actually reconnects and consumes it.
    const stub = stubFor("tenant-assign:__pending__");
    const instanceUid = "01234567-89ab-cdef-0123-456789abcdef";

    // Wake the DO so ensureInit() runs and the SQL tables exist before
    // we try to upsert directly.
    await stub.fetch(new Request("http://internal/pending-devices", { method: "GET" }));

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        const { upsertPendingDevice } = await import("../src/durable-objects/agent-state-repo.js");
        upsertPendingDevice(state.storage.sql, {
          instance_uid: instanceUid,
          tenant_id: "tenant-assign",
        });
      },
    );

    const assignResp = await stub.fetch(
      new Request(`http://internal/pending-devices/${instanceUid}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_id: "config-target" }),
      }),
    );
    expect(assignResp.status).toBe(200);

    await runInDurableObject(
      stub,
      async (instance: InstanceType<typeof ConfigDurableObject>, state) => {
        void instance;
        const deviceRow = state.storage.sql
          .exec(`SELECT instance_uid FROM pending_devices WHERE instance_uid = ?`, instanceUid)
          .toArray();
        expect(deviceRow).toHaveLength(0);
        const assignmentRow = state.storage.sql
          .exec(
            `SELECT instance_uid, target_config_id FROM pending_assignments WHERE instance_uid = ?`,
            instanceUid,
          )
          .toArray();
        expect(assignmentRow).toHaveLength(1);
        expect(assignmentRow[0]!["target_config_id"]).toBe("config-target");
      },
    );
  });
});
