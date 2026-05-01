// Reverse oracle test: TS message builders → protobuf → Go opamp-go verification.
//
// Proves our TypeScript message builders produce protobuf binary that the
// canonical Go opamp-go library can decode and verify field-by-field.
//
// Flow:
// 1. Build messages with our TS builders (@o11yfleet/test-utils)
// 2. Encode to protobuf binary (using @bufbuild/protobuf directly)
// 3. Write as .bin files to tests/oracle/ts-fixtures/
// 4. Invoke `go run . verify ts-fixtures/` — Go decodes and asserts fields
// 5. Also do a TS round-trip: encode → decode → compare

import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  AgentToServerSchema,
  AgentDescriptionSchema,
  AgentDisconnectSchema,
  ComponentHealthSchema,
  EffectiveConfigSchema,
  AgentConfigMapSchema,
  AgentConfigFileSchema,
  RemoteConfigStatusSchema,
  RemoteConfigStatuses as PbRemoteConfigStatuses,
} from "@o11yfleet/core/codec/gen/opamp_pb";
import { KeyValueSchema, AnyValueSchema } from "@o11yfleet/core/codec/gen/anyvalue_pb";
import { decodeAgentToServerProto, RemoteConfigStatuses } from "@o11yfleet/core/codec";
import type { AgentToServer, ComponentHealth } from "@o11yfleet/core/codec";
import {
  buildHello,
  buildHeartbeat,
  buildHealthReport,
  buildConfigAck,
  buildDescriptionReport,
  buildDisconnect,
} from "@o11yfleet/test-utils";

const ORACLE_DIR = resolve(__dirname, "..");
const TS_FIXTURE_DIR = resolve(ORACLE_DIR, "ts-fixtures");
const KNOWN_UID = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

// ─── Protobuf encoder (test-only, mirrors decodeAgentToServerProto) ──

function encodeAgentToServerForOracle(msg: AgentToServer): Uint8Array {
  const pb = create(AgentToServerSchema, {
    instanceUid: msg.instance_uid,
    sequenceNum: BigInt(msg.sequence_num),
    capabilities: BigInt(msg.capabilities),
    flags: BigInt(msg.flags),
  });

  if (msg.agent_description) {
    pb.agentDescription = create(AgentDescriptionSchema, {
      identifyingAttributes: (msg.agent_description.identifying_attributes ?? []).map((kv) =>
        create(KeyValueSchema, {
          key: kv.key,
          value: create(AnyValueSchema, {
            value:
              kv.value.string_value !== null && kv.value.string_value !== undefined
                ? { case: "stringValue" as const, value: kv.value.string_value }
                : { case: undefined, value: undefined },
          }),
        }),
      ),
      nonIdentifyingAttributes: (msg.agent_description.non_identifying_attributes ?? []).map((kv) =>
        create(KeyValueSchema, {
          key: kv.key,
          value: create(AnyValueSchema, {
            value:
              kv.value.string_value !== null && kv.value.string_value !== undefined
                ? { case: "stringValue" as const, value: kv.value.string_value }
                : { case: undefined, value: undefined },
          }),
        }),
      ),
    });
  }

  if (msg.health) {
    pb.health = internalHealthToPb(msg.health);
  }

  if (msg.effective_config?.config_map?.config_map) {
    const configMap: Record<string, { body: Uint8Array; contentType: string }> = {};
    for (const [key, val] of Object.entries(msg.effective_config.config_map.config_map)) {
      configMap[key] = create(AgentConfigFileSchema, {
        body: val.body,
        contentType: val.content_type,
      });
    }
    pb.effectiveConfig = create(EffectiveConfigSchema, {
      configMap: create(AgentConfigMapSchema, { configMap }),
    });
  }

  if (msg.remote_config_status) {
    const statusMap: Record<number, PbRemoteConfigStatuses> = {
      [RemoteConfigStatuses.UNSET]: PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
      [RemoteConfigStatuses.APPLIED]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
      [RemoteConfigStatuses.APPLYING]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLYING,
      [RemoteConfigStatuses.FAILED]: PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED,
    };
    pb.remoteConfigStatus = create(RemoteConfigStatusSchema, {
      lastRemoteConfigHash: msg.remote_config_status.last_remote_config_hash,
      status:
        statusMap[msg.remote_config_status.status] ??
        PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
      errorMessage: msg.remote_config_status.error_message ?? "",
    });
  }

  if (msg.agent_disconnect) {
    pb.agentDisconnect = create(AgentDisconnectSchema, {});
  }

  const payload = toBinary(AgentToServerSchema, pb);
  const wire = new Uint8Array(1 + payload.length);
  wire[0] = 0x00;
  wire.set(payload, 1);
  return wire;
}

function internalHealthToPb(h: ComponentHealth) {
  const componentMap: Record<string, ReturnType<typeof internalHealthToPb>> = {};
  for (const [key, val] of Object.entries(h.component_health_map ?? {})) {
    componentMap[key] = internalHealthToPb(val);
  }
  return create(ComponentHealthSchema, {
    healthy: h.healthy,
    startTimeUnixNano:
      typeof h.start_time_unix_nano === "bigint"
        ? h.start_time_unix_nano
        : BigInt(h.start_time_unix_nano ?? 0),
    lastError: h.last_error ?? "",
    status: h.status ?? "",
    statusTimeUnixNano:
      typeof h.status_time_unix_nano === "bigint"
        ? h.status_time_unix_nano
        : BigInt(h.status_time_unix_nano ?? 0),
    componentHealthMap: componentMap,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Reverse oracle: TS builders → protobuf → Go opamp-go verification", () => {
  beforeAll(() => {
    mkdirSync(TS_FIXTURE_DIR, { recursive: true });

    const hello = buildHello({
      instanceUid: KNOWN_UID,
      name: "oracle-test-agent",
      hostname: "oracle-host",
    });
    writeFileSync(join(TS_FIXTURE_DIR, "hello.bin"), encodeAgentToServerForOracle(hello));

    const heartbeat = buildHeartbeat({ instanceUid: KNOWN_UID, sequenceNum: 42 });
    writeFileSync(join(TS_FIXTURE_DIR, "heartbeat.bin"), encodeAgentToServerForOracle(heartbeat));

    const healthReport = buildHealthReport({
      instanceUid: KNOWN_UID,
      healthy: false,
      lastError: "OOM killed",
      status: "degraded",
    });
    writeFileSync(
      join(TS_FIXTURE_DIR, "health-report.bin"),
      encodeAgentToServerForOracle(healthReport),
    );

    const configAck = buildConfigAck({
      instanceUid: KNOWN_UID,
      configHash: new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]),
    });
    writeFileSync(join(TS_FIXTURE_DIR, "config-ack.bin"), encodeAgentToServerForOracle(configAck));

    const desc = buildDescriptionReport({
      instanceUid: KNOWN_UID,
      name: "description-agent",
      hostname: "prod-host-42",
      osType: "linux",
      arch: "amd64",
    });
    writeFileSync(
      join(TS_FIXTURE_DIR, "description-report.bin"),
      encodeAgentToServerForOracle(desc),
    );

    const disconnect = buildDisconnect({ instanceUid: KNOWN_UID, sequenceNum: 99 });
    writeFileSync(join(TS_FIXTURE_DIR, "disconnect.bin"), encodeAgentToServerForOracle(disconnect));
  });

  it("Go oracle successfully decodes and verifies all TS-built messages", () => {
    const result = execSync(`go run . verify ${TS_FIXTURE_DIR}`, {
      cwd: ORACLE_DIR,
      timeout: 30_000,
      encoding: "utf-8",
    });
    expect(result).toContain("PASS hello");
    expect(result).toContain("PASS heartbeat");
    expect(result).toContain("PASS health-report");
    expect(result).toContain("PASS config-ack");
    expect(result).toContain("PASS description-report");
    expect(result).toContain("PASS disconnect");
    expect(result).toContain("6/6 verified");
  });

  it("round-trip: TS builder → encode → decode → fields match", () => {
    const original = buildHello({
      instanceUid: KNOWN_UID,
      name: "round-trip-agent",
      hostname: "rt-host",
      serviceVersion: "2.0.0",
      healthy: true,
    });

    const wire = encodeAgentToServerForOracle(original);
    const decoded = decodeAgentToServerProto(
      wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength),
    );

    expect(decoded.instance_uid).toEqual(original.instance_uid);
    expect(decoded.sequence_num).toBe(original.sequence_num);
    expect(decoded.capabilities).toBe(original.capabilities);

    // Agent description preserved
    expect(decoded.agent_description).toBeDefined();
    expect(decoded.agent_description!.identifying_attributes).toHaveLength(
      original.agent_description!.identifying_attributes.length,
    );
    const svcName = decoded.agent_description!.identifying_attributes.find(
      (a) => a.key === "service.name",
    );
    expect(svcName!.value.string_value).toBe("round-trip-agent");

    // Health preserved
    expect(decoded.health).toBeDefined();
    expect(decoded.health!.healthy).toBe(true);
    expect(decoded.health!.status).toBe("StatusOK");

    // Effective config preserved
    expect(decoded.effective_config).toBeDefined();
    const cfg = decoded.effective_config!.config_map!.config_map[""];
    expect(cfg).toBeDefined();
    expect(cfg!.content_type).toBe("text/yaml");
    const body = new TextDecoder().decode(cfg!.body);
    expect(body).toContain("receivers:");
  });

  it("heartbeat round-trip has no optional fields", () => {
    const original = buildHeartbeat({ instanceUid: KNOWN_UID, sequenceNum: 99 });
    const wire = encodeAgentToServerForOracle(original);
    const decoded = decodeAgentToServerProto(
      wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength),
    );

    expect(decoded.instance_uid).toEqual(KNOWN_UID);
    expect(decoded.sequence_num).toBe(99);
    expect(decoded.health).toBeUndefined();
    expect(decoded.agent_description).toBeUndefined();
    expect(decoded.effective_config).toBeUndefined();
    expect(decoded.remote_config_status).toBeUndefined();
  });

  it("config ack round-trip preserves hash and status", () => {
    const hash = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const original = buildConfigAck({ instanceUid: KNOWN_UID, configHash: hash });
    const wire = encodeAgentToServerForOracle(original);
    const decoded = decodeAgentToServerProto(
      wire.buffer.slice(wire.byteOffset, wire.byteOffset + wire.byteLength),
    );

    expect(decoded.remote_config_status).toBeDefined();
    expect(decoded.remote_config_status!.last_remote_config_hash).toEqual(hash);
    expect(decoded.remote_config_status!.status).toBe(RemoteConfigStatuses.APPLIED);
  });
});
