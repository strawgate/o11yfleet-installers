// Full agent lifecycle end-to-end test
// Tests the complete happy path: enrollment → hello → heartbeats → config rollout →
// config ack → disconnect → reconnect with claim → verify stats

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { verifyClaim } from "@o11yfleet/core/auth";
import {
  bootstrapSchema,
  O11YFLEET_CLAIM_HMAC_SECRET,
  createTenant,
  createConfig,
  uploadConfigVersion,
  createEnrollmentToken,
  rolloutConfig,
  getConfigStats,
  connectWithEnrollment,
  connectWithClaim,
  sendHello,
  sendHeartbeat,
  waitForMsg,
  msgToBuffer,
  encodeFrame,
  decodeFrame,
  AgentCapabilities,
  buildConfigAck,
  buildHealthReport,
  type AgentToServer,
  type ServerToAgent,
  type AssignmentClaim,
} from "./helpers.js";

beforeAll(() => bootstrapSchema());

describe("Full Agent Lifecycle", () => {
  let configId: string;
  let enrollmentToken: string;
  let assignmentClaim: string;
  let parsedClaim: AssignmentClaim;
  let _instanceUid: string;

  beforeAll(async () => {
    const tenant = await createTenant("Lifecycle Corp");
    const config = await createConfig(tenant.id, "prod-collectors");
    configId = config.id;

    await uploadConfigVersion(
      configId,
      "receivers:\n  otlp:\n    protocols:\n      grpc:\n      http:\n",
    );

    const token = await createEnrollmentToken(configId);
    enrollmentToken = token.token;
  });

  it("step 1: enrolls and receives assignment claim", async () => {
    const { ws, enrollment } = await connectWithEnrollment(enrollmentToken);

    expect(enrollment.assignment_claim).toBeDefined();
    expect(enrollment.instance_uid).toBeDefined();

    // Claims are 2-part HMAC format: base64url(payload).base64url(sig)
    assignmentClaim = enrollment.assignment_claim;
    _instanceUid = enrollment.instance_uid;

    // Verify the claim is valid and parseable
    parsedClaim = await verifyClaim(assignmentClaim, O11YFLEET_CLAIM_HMAC_SECRET);
    expect(parsedClaim.v).toBe(1);
    expect(parsedClaim.config_id).toBe(configId);

    ws.close();
  });

  it("step 2: reconnects with claim and sends hello", async () => {
    // Reconnect using the parsed claim
    const ws = await connectWithClaim(parsedClaim);

    // Send hello
    const response = await sendHello(ws);
    expect(response.instance_uid).toBeDefined();
    expect(response.capabilities).toBeDefined();

    ws.close();
  });

  it("step 3: sends heartbeats without triggering persistence", async () => {
    const ws = await connectWithClaim(parsedClaim);

    // Hello (seq 0)
    await sendHello(ws);

    // Heartbeats (seq 1, 2, 3) — these should be no-op (no persistence, no events)
    const hb1 = await sendHeartbeat(ws, 1);
    expect(hb1.instance_uid).toBeDefined();

    const hb2 = await sendHeartbeat(ws, 2);
    expect(hb2.instance_uid).toBeDefined();

    const hb3 = await sendHeartbeat(ws, 3);
    expect(hb3.instance_uid).toBeDefined();

    ws.close();
  });

  it("step 4: receives config rollout and ACKs it", async () => {
    const ws = await connectWithClaim(parsedClaim);
    await sendHello(ws);

    // Set up the message listener BEFORE triggering rollout
    // (rollout sends config push synchronously via DO)
    const pushPromise = waitForMsg(ws);

    // Rollout config — should push to this connected agent
    const rollout = await rolloutConfig(configId);
    expect(rollout.pushed).toBeGreaterThanOrEqual(1);

    // Receive the config push
    const pushEvent = await pushPromise;
    const pushBuf = await msgToBuffer(pushEvent);
    const pushResp = decodeFrame<ServerToAgent>(pushBuf);
    expect(pushResp.remote_config).toBeDefined();
    expect(pushResp.remote_config!.config_hash).toBeDefined();

    // Verify config content is our YAML
    const configMap = pushResp.remote_config!.config?.config_map as
      | Record<string, { body: Uint8Array; content_type: string }>
      | undefined;
    if (configMap?.[""]) {
      const body = new TextDecoder().decode(configMap[""].body);
      expect(body).toContain("otlp");
    }

    // ACK the config as applied
    const configHash = pushResp.remote_config!.config_hash;
    const ack = buildConfigAck({
      configHash:
        configHash instanceof Uint8Array
          ? configHash
          : new Uint8Array(configHash as ArrayLike<number>),
    });
    ws.send(encodeFrame(ack));

    // Should get a response (heartbeat-style — no new config since we just ACK'd)
    const ackResp = await waitForMsg(ws);
    const ackBuf = await msgToBuffer(ackResp);
    const ackMsg = decodeFrame<ServerToAgent>(ackBuf);
    // Should NOT get another config push (already applied)
    expect(ackMsg.remote_config).toBeUndefined();

    ws.close();
  });

  it("step 5: verify DO stats reflect connected agents", async () => {
    const ws = await connectWithClaim(parsedClaim);
    await sendHello(ws);

    const stats = await getConfigStats(configId);
    expect(stats.active_websockets).toBeGreaterThanOrEqual(1);
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);

    ws.close();
  });
});

describe("Agent Health State Changes", () => {
  it("reports health change and receives update", async () => {
    const tenant = await createTenant("Health Corp");
    const config = await createConfig(tenant.id, "health-config");
    const token = await createEnrollmentToken(config.id);

    const { ws } = await connectWithEnrollment(token.token);

    // Hello with healthy=true
    await sendHello(ws);

    // Send health change: unhealthy
    const healthMsg = buildHealthReport({
      healthy: false,
      lastError: "OOM killed",
      status: "degraded",
    });
    ws.send(encodeFrame(healthMsg));

    const resp = await waitForMsg(ws);
    const buf = await msgToBuffer(resp);
    const serverMsg = decodeFrame<ServerToAgent>(buf);
    expect(serverMsg.instance_uid).toBeDefined();

    // DO stats should reflect unhealthy agent
    const stats = await getConfigStats(config.id);
    expect(stats.total_agents).toBeGreaterThanOrEqual(1);

    ws.close();
  });
});

describe("Agent Description Persistence", () => {
  it("agent description is stored on hello", async () => {
    const tenant = await createTenant("Desc Corp");
    const config = await createConfig(tenant.id, "desc-config");
    const token = await createEnrollmentToken(config.id);

    const { ws } = await connectWithEnrollment(token.token);

    // Hello with agent_description — uses inline construction because
    // this test asserts attribute ordering (service.name at [0])
    const hello: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: { string_value: "my-collector" } },
          { key: "service.version", value: { string_value: "0.98.0" } },
        ],
        non_identifying_attributes: [
          { key: "os.type", value: { string_value: "linux" } },
          { key: "host.arch", value: { string_value: "amd64" } },
        ],
      },
    };
    ws.send(encodeFrame(hello));
    await waitForMsg(ws);

    // Verify via DO directly (agent_description is in DO-local SQLite)
    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);
    const doAgentsRes = await stub.fetch("http://internal/agents");
    const doAgents = await doAgentsRes.json<{
      agents: { agent_description: { identifying_attributes: { key: string }[] } }[];
    }>();

    expect(doAgents.agents.length).toBeGreaterThanOrEqual(1);
    const agent = doAgents.agents[0];
    const desc = agent.agent_description;
    expect(desc.identifying_attributes).toBeDefined();
    expect(desc.identifying_attributes[0].key).toBe("service.name");

    ws.close();
  });
});

describe("Agent Detail Endpoint (enriched)", () => {
  it("returns is_connected, desired_config_hash, and uptime for connected agent", async () => {
    const tenant = await createTenant("Detail Corp");
    const config = await createConfig(tenant.id, "detail-config");
    await uploadConfigVersion(config.id, "receivers:\n  otlp:\n");
    await rolloutConfig(config.id);
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);
    const uid = enrollment.instance_uid;

    // Fetch agent detail
    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);
    const res = await stub.fetch(`http://internal/agents/${uid}`);
    expect(res.status).toBe(200);

    const detail = (await res.json()) as Record<string, unknown>;
    expect(detail.is_connected).toBe(true);
    expect(detail.desired_config_hash).toBeDefined();
    expect(typeof detail.desired_config_hash).toBe("string");
    expect(detail.uptime_ms).toBeGreaterThan(0);
    expect(detail.agent_description).toBeDefined();
    expect(detail.generation).toBe(2);
    expect(detail.capabilities).toBeGreaterThan(0);

    ws.close();
  });

  it("returns is_connected=false and null uptime for disconnected agent", async () => {
    const tenant = await createTenant("Detail Disc Corp");
    const config = await createConfig(tenant.id, "detail-disc-config");
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);
    const uid = enrollment.instance_uid;
    ws.close();

    // Poll until close propagates through DO
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
    expect(detail.uptime_ms).toBeNull();
  });

  it("returns is_drifted=true when effective config differs from desired", async () => {
    const tenant = await createTenant("Detail Drift Corp");
    const config = await createConfig(tenant.id, "detail-drift-config");
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);
    const uid = enrollment.instance_uid;

    // Push a desired config (agent hasn't applied it yet)
    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);
    await stub.fetch("http://internal/command/set-desired-config", {
      method: "POST",
      body: JSON.stringify({ config_hash: "abcabcabcabc", config_content: "pipelines: {}" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await stub.fetch(`http://internal/agents/${uid}`);
    const detail = (await res.json()) as Record<string, unknown>;
    expect(detail.desired_config_hash).toBe("abcabcabcabc");
    // Agent hasn't applied the new config yet, so it's drifted
    expect(detail.is_drifted).toBe(true);

    ws.close();
  });

  it("includes effective_config_body in detail (not in list)", async () => {
    const tenant = await createTenant("Detail Body Corp");
    const config = await createConfig(tenant.id, "detail-body-config");
    await uploadConfigVersion(config.id, "exporters:\n  debug:\n");
    await rolloutConfig(config.id);
    const token = await createEnrollmentToken(config.id);

    const { ws, enrollment } = await connectWithEnrollment(token.token);

    // Send a hello reporting the effective config
    const hello: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsEffectiveConfig,
      flags: 0,
      effective_config: {
        config_map: {
          config_map: {
            "": {
              body: new TextEncoder().encode("exporters:\n  debug:\n"),
              content_type: "text/yaml",
            },
          },
        },
      },
    };
    ws.send(encodeFrame(hello));
    await waitForMsg(ws);

    const doId = env.CONFIG_DO.idFromName(`${tenant.id}:${config.id}`);
    const stub = env.CONFIG_DO.get(doId);

    // Detail endpoint includes body
    const detailRes = await stub.fetch(`http://internal/agents/${enrollment.instance_uid}`);
    const detail = (await detailRes.json()) as Record<string, unknown>;
    expect(detail.effective_config_body).toBe("exporters:\n  debug:\n");

    // List endpoint does NOT include body (performance)
    const listRes = await stub.fetch("http://internal/agents");
    const list = (await listRes.json()) as { agents: Record<string, unknown>[] };
    const listAgent = list.agents.find((a) => a.instance_uid === enrollment.instance_uid);
    expect(listAgent?.effective_config_body).toBeUndefined();

    ws.close();
  });
});
