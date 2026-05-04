import { env } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
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
} from "./helpers.js";

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
