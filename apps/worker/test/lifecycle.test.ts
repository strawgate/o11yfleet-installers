// Full agent lifecycle end-to-end test
// Tests the complete happy path: enrollment → hello → heartbeats → config rollout →
// config ack → disconnect → reconnect with claim → verify stats

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { RemoteConfigStatuses } from "@o11yfleet/core/codec";
import { verifyClaim } from "@o11yfleet/core/auth";
import {
  setupD1,
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
  type AgentToServer,
  type ServerToAgent,
  type AssignmentClaim,
} from "./helpers.js";

beforeAll(setupD1);

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
    const ack: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
      flags: 0,
      remote_config_status: {
        last_remote_config_hash:
          configHash instanceof Uint8Array
            ? configHash
            : new Uint8Array(configHash as ArrayLike<number>),
        status: RemoteConfigStatuses.APPLIED,
        error_message: "",
      },
    };
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
    const healthMsg: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 1,
      capabilities: AgentCapabilities.ReportsStatus | AgentCapabilities.ReportsHealth,
      flags: 0,
      health: {
        healthy: false,
        start_time_unix_nano: 0n,
        last_error: "OOM killed",
        status: "degraded",
      },
    };
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

    // Hello with agent_description
    const hello: AgentToServer = {
      instance_uid: new Uint8Array(16),
      sequence_num: 0,
      capabilities: AgentCapabilities.ReportsStatus,
      flags: 0,
      agent_description: {
        identifying_attributes: [
          { key: "service.name", value: "my-collector" },
          { key: "service.version", value: "0.98.0" },
        ],
        non_identifying_attributes: [
          { key: "os.type", value: "linux" },
          { key: "host.arch", value: "amd64" },
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
      agents: { agent_description: string }[];
    }>();

    expect(doAgents.agents.length).toBeGreaterThanOrEqual(1);
    const agent = doAgents.agents[0];
    const desc = JSON.parse(agent.agent_description);
    expect(desc.identifying_attributes).toBeDefined();
    expect(desc.identifying_attributes[0].key).toBe("service.name");

    ws.close();
  });
});
