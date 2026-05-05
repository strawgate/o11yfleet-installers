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
