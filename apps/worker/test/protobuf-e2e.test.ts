// Protobuf E2E integration tests — prove the standard OpAMP wire format works
// end-to-end through the DO WebSocket path. This is the path real OTel Collectors use.

import { describe, it, expect, beforeAll } from "vitest";
import { exports } from "cloudflare:workers";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  AgentToServerSchema,
  ServerToAgentSchema,
  AgentDescriptionSchema,
  ComponentHealthSchema,
  EffectiveConfigSchema,
  AgentConfigMapSchema,
  AgentConfigFileSchema,
  RemoteConfigStatusSchema,
  AgentDisconnectSchema,
  RemoteConfigStatuses as PbRemoteConfigStatuses,
} from "@o11yfleet/core/codec/gen/opamp_pb";
import { KeyValueSchema, AnyValueSchema } from "@o11yfleet/core/codec/gen/anyvalue_pb";
import { AgentCapabilities, ServerCapabilities } from "@o11yfleet/core/codec";
import {
  setupD1,
  createTenant,
  createConfig,
  createEnrollmentToken,
  uploadConfigVersion,
  rolloutConfig,
  getConfigStats,
  waitForMsg,
} from "./helpers.js";

// ─── Helpers ────────────────────────────────────────────────────────

function agentUid(): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytes;
}

function buildProtobufHello(uid: Uint8Array, seq = 0): ArrayBuffer {
  const desc = create(AgentDescriptionSchema, {
    identifyingAttributes: [
      create(KeyValueSchema, {
        key: "service.name",
        value: create(AnyValueSchema, {
          value: { case: "stringValue", value: "otelcol-contrib" },
        }),
      }),
      create(KeyValueSchema, {
        key: "service.version",
        value: create(AnyValueSchema, {
          value: { case: "stringValue", value: "0.96.0" },
        }),
      }),
    ],
    nonIdentifyingAttributes: [
      create(KeyValueSchema, {
        key: "os.type",
        value: create(AnyValueSchema, {
          value: { case: "stringValue", value: "linux" },
        }),
      }),
    ],
  });

  const health = create(ComponentHealthSchema, {
    healthy: true,
    status: "running",
    lastError: "",
    startTimeUnixNano: BigInt(Date.now()) * 1000000n,
    statusTimeUnixNano: BigInt(Date.now()) * 1000000n,
  });

  const msg = create(AgentToServerSchema, {
    instanceUid: uid,
    sequenceNum: BigInt(seq),
    capabilities: BigInt(
      AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsEffectiveConfig |
        AgentCapabilities.ReportsHealth |
        AgentCapabilities.ReportsRemoteConfig,
    ),
    flags: 0n,
    agentDescription: desc,
    health,
  });

  const bytes = toBinary(AgentToServerSchema, msg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function buildProtobufHeartbeat(uid: Uint8Array, seq: number): ArrayBuffer {
  const msg = create(AgentToServerSchema, {
    instanceUid: uid,
    sequenceNum: BigInt(seq),
    capabilities: BigInt(
      AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsHealth |
        AgentCapabilities.ReportsRemoteConfig,
    ),
    flags: 0n,
  });
  const bytes = toBinary(AgentToServerSchema, msg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function buildProtobufConfigAck(uid: Uint8Array, seq: number, configHash: Uint8Array): ArrayBuffer {
  const msg = create(AgentToServerSchema, {
    instanceUid: uid,
    sequenceNum: BigInt(seq),
    capabilities: BigInt(
      AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsRemoteConfig,
    ),
    flags: 0n,
    remoteConfigStatus: create(RemoteConfigStatusSchema, {
      lastRemoteConfigHash: configHash,
      status: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
      errorMessage: "",
    }),
  });
  const bytes = toBinary(AgentToServerSchema, msg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function buildProtobufDisconnect(uid: Uint8Array, seq: number): ArrayBuffer {
  const msg = create(AgentToServerSchema, {
    instanceUid: uid,
    sequenceNum: BigInt(seq),
    capabilities: 0n,
    flags: 0n,
    agentDisconnect: create(AgentDisconnectSchema),
  });
  const bytes = toBinary(AgentToServerSchema, msg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function buildProtobufEffectiveConfig(
  uid: Uint8Array,
  seq: number,
  yamlContent: string,
): ArrayBuffer {
  const msg = create(AgentToServerSchema, {
    instanceUid: uid,
    sequenceNum: BigInt(seq),
    capabilities: BigInt(
      AgentCapabilities.ReportsStatus |
        AgentCapabilities.AcceptsRemoteConfig |
        AgentCapabilities.ReportsEffectiveConfig |
        AgentCapabilities.ReportsHealth |
        AgentCapabilities.ReportsRemoteConfig,
    ),
    flags: 0n,
    effectiveConfig: create(EffectiveConfigSchema, {
      configMap: create(AgentConfigMapSchema, {
        configMap: {
          "": create(AgentConfigFileSchema, {
            body: new TextEncoder().encode(yamlContent),
            contentType: "text/yaml",
          }),
        },
      }),
    }),
  });
  const bytes = toBinary(AgentToServerSchema, msg);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function msgToArrayBuffer(event: MessageEvent): Promise<ArrayBuffer> {
  return event.data instanceof Blob
    ? await (event.data as Blob).arrayBuffer()
    : (event.data as ArrayBuffer);
}

function decodeServerResponse(buf: ArrayBuffer) {
  // Strip opamp-go varint header (0x00) if present
  let data = new Uint8Array(buf);
  if (data.length > 0 && data[0] === 0x00) {
    data = data.subarray(1);
  }
  return fromBinary(ServerToAgentSchema, data);
}

// ─── Test Suite ────────────────────────────────────────────────────

describe("Protobuf E2E — real OTel Collector wire format", () => {
  let tenantId: string;
  let configId: string;

  beforeAll(async () => {
    await setupD1();
    const tenant = await createTenant("pb-test-tenant");
    tenantId = tenant.id;
    const config = await createConfig(tenantId, "pb-test-config");
    configId = config.id;
  });

  it("enrolls a protobuf agent and receives ServerToAgent in protobuf", async () => {
    const { token } = await createEnrollmentToken(configId);
    const uid = agentUid();

    // Connect with enrollment token
    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Send protobuf hello (client sends first per OpAMP spec)
    ws.send(buildProtobufHello(uid));

    // Receive protobuf binary response (no enrollment_complete for protobuf clients)
    const responseEvent = await waitForMsg(ws);
    const buf = await msgToArrayBuffer(responseEvent);
    const response = decodeServerResponse(buf);

    // Verify server capabilities
    expect(Number(response.capabilities) & ServerCapabilities.AcceptsStatus).toBeTruthy();
    expect(Number(response.capabilities) & ServerCapabilities.OffersRemoteConfig).toBeTruthy();
    expect(Number(response.capabilities) & ServerCapabilities.AcceptsEffectiveConfig).toBeTruthy();

    ws.close();
  });

  it("pushes config to protobuf agent and receives config ACK", async () => {
    const { token } = await createEnrollmentToken(configId);
    const uid = agentUid();

    // Upload a config version
    const yamlContent =
      "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317";
    await uploadConfigVersion(configId, yamlContent);
    await rolloutConfig(configId);

    // Connect and enroll
    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    ws.send(buildProtobufHello(uid));

    // Skip enrollment text frame (not sent to protobuf clients)
    // await waitForMsg(ws);

    // Get binary response — should contain config
    const responseEvent = await waitForMsg(ws);
    const buf = await msgToArrayBuffer(responseEvent);
    const response = decodeServerResponse(buf);

    expect(response.remoteConfig).toBeDefined();
    expect(response.remoteConfig!.configHash.byteLength).toBeGreaterThan(0);
    const configMap = response.remoteConfig!.config?.configMap ?? {};
    const entry = configMap[""];
    expect(entry).toBeDefined();
    const body = new TextDecoder().decode(entry.body);
    expect(body).toContain("receivers:");

    // Send config ACK
    ws.send(buildProtobufConfigAck(uid, 1, response.remoteConfig!.configHash));
    const ackResponse = await waitForMsg(ws);
    const ackBuf = await msgToArrayBuffer(ackResponse);
    const ackMsg = decodeServerResponse(ackBuf);
    // After ACK, should not re-offer config
    expect(ackMsg.remoteConfig).toBeUndefined();

    ws.close();
  });

  it("handles protobuf heartbeats without config re-offer", async () => {
    const { token } = await createEnrollmentToken(configId);
    const uid = agentUid();

    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Hello
    ws.send(buildProtobufHello(uid));
    const helloResp = await waitForMsg(ws);
    const helloBuf = await msgToArrayBuffer(helloResp);
    const helloMsg = decodeServerResponse(helloBuf);

    // ACK config if offered
    if (helloMsg.remoteConfig) {
      ws.send(buildProtobufConfigAck(uid, 1, helloMsg.remoteConfig.configHash));
      await waitForMsg(ws);
    }

    // Send heartbeats
    const nextSeq = helloMsg.remoteConfig ? 2 : 1;
    ws.send(buildProtobufHeartbeat(uid, nextSeq));
    const hbResp = await waitForMsg(ws);
    const hbBuf = await msgToArrayBuffer(hbResp);
    const hbMsg = decodeServerResponse(hbBuf);
    expect(hbMsg.remoteConfig).toBeUndefined();

    ws.close();
  });

  it("handles protobuf disconnect gracefully", async () => {
    const { token } = await createEnrollmentToken(configId);
    const uid = agentUid();

    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Hello
    ws.send(buildProtobufHello(uid));
    await waitForMsg(ws); // hello response

    // Send disconnect — no response expected (per OpAMP spec)
    ws.send(buildProtobufDisconnect(uid, 1));

    // Server should close the connection (or at least not send anything back)
    // The disconnect message returns null response, so the server won't send anything.
    // Give a small window then close.
    await new Promise<void>((r) => {
      setTimeout(r, 100);
    });
    ws.close();
  });

  it("reports effective config via protobuf", async () => {
    const { token } = await createEnrollmentToken(configId);
    const uid = agentUid();

    const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();

    // Hello
    ws.send(buildProtobufHello(uid));
    const helloResp = await waitForMsg(ws); // hello response

    // ACK any offered config
    const helloBuf = await msgToArrayBuffer(helloResp);
    const helloMsg = decodeServerResponse(helloBuf);
    let nextSeq = 1;
    if (helloMsg.remoteConfig) {
      ws.send(buildProtobufConfigAck(uid, nextSeq, helloMsg.remoteConfig.configHash));
      await waitForMsg(ws);
      nextSeq++;
    }

    // Send effective config report
    const effectiveYaml =
      "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: localhost:4317\nexporters:\n  debug:";
    ws.send(buildProtobufEffectiveConfig(uid, nextSeq, effectiveYaml));
    const effResp = await waitForMsg(ws);
    const effBuf = await msgToArrayBuffer(effResp);
    const effMsg = decodeServerResponse(effBuf);

    // Response should be valid (no error)
    expect(effMsg.errorResponse).toBeUndefined();

    ws.close();
  });

  it("handles multiple concurrent protobuf agents", async () => {
    const NUM_AGENTS = 10;
    const agents: { ws: WebSocket; uid: Uint8Array }[] = [];

    // Connect all agents
    for (let i = 0; i < NUM_AGENTS; i++) {
      const { token } = await createEnrollmentToken(configId);
      const uid = agentUid();

      const wsRes = await exports.default.fetch("http://localhost/v1/opamp", {
        headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
      });
      expect(wsRes.status).toBe(101);
      const ws = wsRes.webSocket!;
      ws.accept();
      agents.push({ ws, uid });
    }

    // Send hellos from all agents
    const enrollPromises = agents.map(async ({ ws, uid }) => {
      ws.send(buildProtobufHello(uid));
      // Protobuf clients get ServerToAgent directly (no enrollment_complete text frame)
      const respEvent = await waitForMsg(ws);
      const buf = await msgToArrayBuffer(respEvent);
      return decodeServerResponse(buf);
    });

    const responses = await Promise.all(enrollPromises);
    expect(responses).toHaveLength(NUM_AGENTS);
    for (const resp of responses) {
      expect(Number(resp.capabilities) & ServerCapabilities.AcceptsStatus).toBeTruthy();
    }

    // Check stats
    const stats = await getConfigStats(configId);
    expect(stats.active_websockets).toBeGreaterThanOrEqual(NUM_AGENTS);

    // Cleanup
    for (const { ws } of agents) {
      ws.close();
    }
  });
});
