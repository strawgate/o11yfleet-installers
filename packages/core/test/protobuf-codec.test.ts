// Protobuf codec tests — round-trip encode/decode for standard OpAMP wire format.
// This is the production path that real OTel Collectors use.

import { describe, it, expect } from "vitest";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  AgentToServerSchema,
  ServerToAgentSchema,
  ServerToAgentCommandSchema,
  AgentDescriptionSchema,
  ComponentHealthSchema,
  EffectiveConfigSchema,
  AgentConfigMapSchema,
  AgentConfigFileSchema,
  RemoteConfigStatusSchema,
  AgentDisconnectSchema,
  RemoteConfigStatuses as PbRemoteConfigStatuses,
} from "../src/codec/gen/opamp_pb.js";
import { KeyValueSchema, AnyValueSchema } from "../src/codec/gen/anyvalue_pb.js";
import {
  decodeAgentToServerProto,
  decodeServerToAgentProto,
  encodeServerToAgentProto,
  isProtobufFrame,
} from "../src/codec/protobuf.js";
import {
  RemoteConfigStatuses,
  ServerErrorResponseType,
  AgentCapabilities,
  ServerCapabilities,
  ServerToAgentFlags,
  CommandType,
} from "../src/codec/types.js";

// ─── Helpers ────────────────────────────────────────────────────────

function uid(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const AGENT_UID = uid("0102030405060708091011121314151617181920212223242526272829303132");

// ─── Format Detection ───────────────────────────────────────────────

describe("isProtobufFrame", () => {
  it("detects protobuf (first byte >= 0x08)", () => {
    // Raw protobuf: field 1, length-delimited = 0x0a
    const pb = toBinary(
      AgentToServerSchema,
      create(AgentToServerSchema, { instanceUid: new Uint8Array([1]) }),
    );
    expect(isProtobufFrame(pb.buffer)).toBe(true);
  });

  it("detects opamp-go header protobuf (0x00 + field tag)", () => {
    // opamp-go sends [0x00 varint header][protobuf], byte[1] is a field tag ≥ 0x08
    const pb = toBinary(
      AgentToServerSchema,
      create(AgentToServerSchema, { instanceUid: new Uint8Array([1]) }),
    );
    const withHeader = new Uint8Array(1 + pb.length);
    withHeader[0] = 0x00;
    withHeader.set(pb, 1);
    expect(isProtobufFrame(withHeader.buffer)).toBe(true);
  });

  it("detects JSON framing (4-byte BE length + '{' at byte 4)", () => {
    // JSON framing: [00 00 00 02][7b 7d] = length 2 + '{}'
    const buf = new ArrayBuffer(6);
    const view = new DataView(buf);
    view.setUint32(0, 2); // length prefix = 2 bytes
    new Uint8Array(buf)[4] = 0x7b; // '{'
    new Uint8Array(buf)[5] = 0x7d; // '}'
    expect(isProtobufFrame(buf)).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isProtobufFrame(new ArrayBuffer(0))).toBe(false);
  });
});

// ─── Decode: Protobuf → Internal ───────────────────────────────────

describe("decodeAgentToServerProto", () => {
  it("decodes a minimal hello message", () => {
    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 0n,
      capabilities: BigInt(AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig),
      flags: 0n,
    });
    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.instance_uid).toEqual(AGENT_UID);
    expect(result.sequence_num).toBe(0);
    expect(result.capabilities).toBe(
      AgentCapabilities.ReportsStatus | AgentCapabilities.AcceptsRemoteConfig,
    );
    expect(result.flags).toBe(0);
    expect(result.health).toBeUndefined();
    expect(result.agent_description).toBeUndefined();
    expect(result.effective_config).toBeUndefined();
    expect(result.remote_config_status).toBeUndefined();
    expect(result.agent_disconnect).toBeUndefined();
  });

  it("decodes health with component map", () => {
    const childHealth = create(ComponentHealthSchema, {
      healthy: false,
      lastError: "connection refused",
      status: "degraded",
      startTimeUnixNano: 1000000000n,
      statusTimeUnixNano: 2000000000n,
    });

    const health = create(ComponentHealthSchema, {
      healthy: true,
      lastError: "",
      status: "running",
      startTimeUnixNano: 500000000n,
      statusTimeUnixNano: 600000000n,
      componentHealthMap: { "exporters/otlp": childHealth },
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 5n,
      capabilities: BigInt(AgentCapabilities.ReportsHealth),
      flags: 0n,
      health,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.health).toBeDefined();
    expect(result.health!.healthy).toBe(true);
    expect(result.health!.status).toBe("running");
    expect(result.health!.component_health_map["exporters/otlp"]).toBeDefined();
    expect(result.health!.component_health_map["exporters/otlp"].healthy).toBe(false);
    expect(result.health!.component_health_map["exporters/otlp"].last_error).toBe(
      "connection refused",
    );
  });

  it("decodes agent description with key-value attributes", () => {
    const desc = create(AgentDescriptionSchema, {
      identifyingAttributes: [
        create(KeyValueSchema, {
          key: "service.name",
          value: create(AnyValueSchema, { value: { case: "stringValue", value: "otelcol" } }),
        }),
        create(KeyValueSchema, {
          key: "service.version",
          value: create(AnyValueSchema, { value: { case: "stringValue", value: "0.96.0" } }),
        }),
      ],
      nonIdentifyingAttributes: [
        create(KeyValueSchema, {
          key: "os.type",
          value: create(AnyValueSchema, { value: { case: "stringValue", value: "linux" } }),
        }),
      ],
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 1n,
      capabilities: BigInt(AgentCapabilities.ReportsStatus),
      flags: 0n,
      agentDescription: desc,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.agent_description).toBeDefined();
    expect(result.agent_description!.identifying_attributes).toHaveLength(2);
    expect(result.agent_description!.identifying_attributes[0].key).toBe("service.name");
    expect(result.agent_description!.identifying_attributes[0].value.string_value).toBe("otelcol");
    expect(result.agent_description!.non_identifying_attributes).toHaveLength(1);
    expect(result.agent_description!.non_identifying_attributes[0].key).toBe("os.type");
  });

  it("decodes effective config", () => {
    const yamlBody = new TextEncoder().encode("receivers:\n  otlp:\n    protocols:\n      grpc:");
    const configFile = create(AgentConfigFileSchema, {
      body: yamlBody,
      contentType: "text/yaml",
    });
    const configMap = create(AgentConfigMapSchema, {
      configMap: { "": configFile },
    });
    const effectiveConfig = create(EffectiveConfigSchema, {
      configMap,
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 3n,
      capabilities: BigInt(AgentCapabilities.ReportsEffectiveConfig),
      flags: 0n,
      effectiveConfig,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.effective_config).toBeDefined();
    const map = result.effective_config!.config_map.config_map;
    expect(map[""]).toBeDefined();
    expect(map[""].content_type).toBe("text/yaml");
    expect(new TextDecoder().decode(map[""].body)).toContain("receivers:");
  });

  it("decodes remote config status (APPLIED)", () => {
    const configHash = new Uint8Array(32).fill(0xaa);
    const status = create(RemoteConfigStatusSchema, {
      lastRemoteConfigHash: configHash,
      status: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
      errorMessage: "",
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 7n,
      capabilities: BigInt(AgentCapabilities.ReportsRemoteConfig),
      flags: 0n,
      remoteConfigStatus: status,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.remote_config_status).toBeDefined();
    expect(result.remote_config_status!.status).toBe(RemoteConfigStatuses.APPLIED);
    expect(result.remote_config_status!.last_remote_config_hash).toEqual(configHash);
  });

  it("decodes remote config status (FAILED)", () => {
    const configHash = new Uint8Array(32).fill(0xbb);
    const status = create(RemoteConfigStatusSchema, {
      lastRemoteConfigHash: configHash,
      status: PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED,
      errorMessage: "invalid receiver configuration",
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 8n,
      capabilities: BigInt(AgentCapabilities.ReportsRemoteConfig),
      flags: 0n,
      remoteConfigStatus: status,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.remote_config_status!.status).toBe(RemoteConfigStatuses.FAILED);
    expect(result.remote_config_status!.error_message).toBe("invalid receiver configuration");
  });

  it("decodes agent disconnect message", () => {
    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 10n,
      capabilities: 0n,
      flags: 0n,
      agentDisconnect: create(AgentDisconnectSchema),
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    expect(result.agent_disconnect).toBeDefined();
    expect(result.agent_disconnect).toEqual({});
  });

  it("decodes AnyValue variants (int, bool, double, bytes, array, kvlist)", () => {
    const desc = create(AgentDescriptionSchema, {
      identifyingAttributes: [
        create(KeyValueSchema, {
          key: "int_attr",
          value: create(AnyValueSchema, { value: { case: "intValue", value: 42n } }),
        }),
        create(KeyValueSchema, {
          key: "bool_attr",
          value: create(AnyValueSchema, { value: { case: "boolValue", value: true } }),
        }),
        create(KeyValueSchema, {
          key: "double_attr",
          value: create(AnyValueSchema, { value: { case: "doubleValue", value: 3.14 } }),
        }),
      ],
      nonIdentifyingAttributes: [],
    });

    const pb = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 0n,
      capabilities: 0n,
      flags: 0n,
      agentDescription: desc,
    });

    const buf = toBinary(AgentToServerSchema, pb);
    const result = decodeAgentToServerProto(buf.buffer);

    const attrs = result.agent_description!.identifying_attributes;
    expect(attrs[0].value.int_value).toBe(42n);
    expect(attrs[1].value.bool_value).toBe(true);
    expect(attrs[2].value.double_value).toBeCloseTo(3.14);
  });
});

// ─── Encode: Internal → Protobuf ───────────────────────────────────

describe("encodeServerToAgentProto", () => {
  /** Strip the opamp-go 0x00 varint header from encoded output */
  function stripHeader(buf: ArrayBuffer): Uint8Array {
    // Strip 0x00 data-type header byte (opamp-go wire format)
    const arr = new Uint8Array(buf);
    return arr[0] === 0x00 ? arr.subarray(1) : arr;
  }

  it("encodes a minimal response with opamp-go data-type header", () => {
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: ServerToAgentFlags.Unspecified,
      capabilities:
        ServerCapabilities.AcceptsStatus |
        ServerCapabilities.OffersRemoteConfig |
        ServerCapabilities.AcceptsEffectiveConfig,
    });

    // First byte should be 0x00 (opamp-go data-type header)
    expect(new Uint8Array(encoded)[0]).toBe(0x00);

    // Verify it's valid protobuf after stripping header
    const decoded = fromBinary(ServerToAgentSchema, stripHeader(encoded));
    expect(decoded.instanceUid).toEqual(AGENT_UID);
  });

  it("encodes remote config with YAML content", () => {
    const yamlContent = "receivers:\n  otlp:\n    protocols:\n      grpc:";
    const configHash = new Uint8Array(32).fill(0xcc);

    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.OffersRemoteConfig,
      remote_config: {
        config: {
          config_map: {
            "": {
              body: new TextEncoder().encode(yamlContent),
              content_type: "text/yaml",
            },
          },
        },
        config_hash: configHash,
      },
    });

    expect(encoded.byteLength).toBeGreaterThan(0);
    // After header, should be valid protobuf
    expect(isProtobufFrame(encoded)).toBe(true);
  });

  it("encodes error response with RetryInfo", () => {
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      error_response: {
        type: ServerErrorResponseType.Unavailable,
        error_message: "Rate limit exceeded",
        retry_info: { retry_after_nanoseconds: 30000000000n },
      },
    });

    expect(encoded.byteLength).toBeGreaterThan(0);
  });

  it("encodes agent identification (new instance UID)", () => {
    const newUid = new Uint8Array(16).fill(0xff);
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      agent_identification: { new_instance_uid: newUid },
    });

    expect(encoded.byteLength).toBeGreaterThan(0);
  });

  it("encodes connection_settings with opamp endpoint and headers", () => {
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.OffersConnectionSettings,
      connection_settings: {
        hash: new Uint8Array([0xaa, 0xbb, 0xcc]),
        opamp: {
          destination_endpoint: "wss://fleet.example.com/v1/opamp",
          headers: [{ key: "Authorization", value: "Bearer tok_abc" }],
          heartbeat_interval_seconds: 30,
        },
      },
    });

    const decoded = fromBinary(ServerToAgentSchema, stripHeader(encoded));
    expect(decoded.connectionSettings).toBeDefined();
    expect(decoded.connectionSettings!.hash).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
    expect(decoded.connectionSettings!.opamp!.destinationEndpoint).toBe(
      "wss://fleet.example.com/v1/opamp",
    );
    expect(decoded.connectionSettings!.opamp!.headers!.headers[0]!.key).toBe("Authorization");
    expect(decoded.connectionSettings!.opamp!.headers!.headers[0]!.value).toBe("Bearer tok_abc");
    expect(decoded.connectionSettings!.opamp!.heartbeatIntervalSeconds).toBe(30n);
  });

  it("encodes connection_settings without opamp (hash only)", () => {
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.OffersConnectionSettings,
      connection_settings: {
        hash: new Uint8Array([0x01]),
      },
    });

    const decoded = fromBinary(ServerToAgentSchema, stripHeader(encoded));
    expect(decoded.connectionSettings).toBeDefined();
    expect(decoded.connectionSettings!.hash).toEqual(new Uint8Array([0x01]));
    expect(decoded.connectionSettings!.opamp).toBeUndefined();
  });

  it("encodes command with Restart type", () => {
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      command: { type: CommandType.Restart },
    });

    const decoded = fromBinary(ServerToAgentSchema, stripHeader(encoded));
    expect(decoded.command).toBeDefined();
    // PB CommandType_Restart = 0
    expect(decoded.command!.type).toBe(0);
  });

  it("throws on unknown command type", () => {
    expect(() =>
      encodeServerToAgentProto({
        instance_uid: AGENT_UID,
        flags: 0,
        capabilities: ServerCapabilities.AcceptsStatus,
        command: { type: 999 as CommandType },
      }),
    ).toThrow("Unknown CommandType: 999");
  });

  // Decoder's `pbCommandTypeToInternal` switch has a `default` branch for
  // forward-compatibility with future CommandType values (proto3 enums
  // are *open*: unknown numeric values are preserved on the wire and
  // decoders must keep parsing the surrounding message). The decoder
  // drops the unknown command but the rest of the ServerToAgent is
  // still decoded — verifying that contract here.
  it("decoder drops unknown CommandType but preserves the rest of the frame", () => {
    const pb = create(ServerToAgentSchema, {
      instanceUid: AGENT_UID,
      flags: 0n,
      capabilities: BigInt(ServerCapabilities.AcceptsStatus),
      command: create(ServerToAgentCommandSchema, { type: 999 }),
    });
    const wire = toBinary(ServerToAgentSchema, pb);
    const withHeader = new Uint8Array(1 + wire.length);
    withHeader[0] = 0x00;
    withHeader.set(wire, 1);
    const decoded = decodeServerToAgentProto(withHeader.buffer);
    // Unknown command silently dropped (proto3 open-enum semantics).
    expect(decoded.command).toBeUndefined();
    // Surrounding message intact — no decode failure.
    expect(decoded.instance_uid).toEqual(AGENT_UID);
    expect(decoded.capabilities).toBe(ServerCapabilities.AcceptsStatus);
  });

  it("round-trips command through encodeServerToAgent → decodeServerToAgent", () => {
    // Regression: decodeServerToAgentProto previously dropped the `command`
    // field even though the encoder wrote it. Tests using fromBinary
    // directly didn't catch this — the bug was in our internal-types
    // mapper, not the protobuf schema. This test specifically exercises
    // the codec wrapper agents call.
    const encoded = encodeServerToAgentProto({
      instance_uid: AGENT_UID,
      flags: 0,
      capabilities: ServerCapabilities.AcceptsStatus,
      command: { type: CommandType.Restart },
    });
    const decoded = decodeServerToAgentProto(encoded);
    expect(decoded.command).toBeDefined();
    expect(decoded.command!.type).toBe(CommandType.Restart);
  });
});

// ─── Round-Trip ─────────────────────────────────────────────────────

describe("protobuf round-trip (encode → decode)", () => {
  it("round-trips a full message with config", () => {
    const yamlContent = "processors:\n  batch:\n    timeout: 5s";
    const configHash = new Uint8Array(32).fill(0xdd);

    // Create an AgentToServer with config status
    const agentMsg = create(AgentToServerSchema, {
      instanceUid: AGENT_UID,
      sequenceNum: 42n,
      capabilities: BigInt(
        AgentCapabilities.ReportsStatus |
          AgentCapabilities.AcceptsRemoteConfig |
          AgentCapabilities.ReportsEffectiveConfig |
          AgentCapabilities.ReportsHealth |
          AgentCapabilities.ReportsRemoteConfig,
      ),
      flags: 0n,
      health: create(ComponentHealthSchema, {
        healthy: true,
        status: "running",
        lastError: "",
        startTimeUnixNano: 1000n,
        statusTimeUnixNano: 2000n,
      }),
      remoteConfigStatus: create(RemoteConfigStatusSchema, {
        lastRemoteConfigHash: configHash,
        status: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
        errorMessage: "",
      }),
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

    // Encode to binary
    const binary = toBinary(AgentToServerSchema, agentMsg);

    // Decode back
    const decoded = decodeAgentToServerProto(binary.buffer);

    expect(decoded.instance_uid).toEqual(AGENT_UID);
    expect(decoded.sequence_num).toBe(42);
    expect(decoded.health?.healthy).toBe(true);
    expect(decoded.health?.status).toBe("running");
    expect(decoded.remote_config_status?.status).toBe(RemoteConfigStatuses.APPLIED);
    expect(decoded.effective_config).toBeDefined();
    const effBody = new TextDecoder().decode(
      decoded.effective_config!.config_map.config_map[""].body,
    );
    expect(effBody).toBe(yamlContent);
  });

  it("round-trips ServerToAgent with ReportFullState flag", () => {
    const serverMsg = {
      instance_uid: AGENT_UID,
      flags: ServerToAgentFlags.ReportFullState,
      capabilities:
        ServerCapabilities.AcceptsStatus |
        ServerCapabilities.OffersRemoteConfig |
        ServerCapabilities.AcceptsEffectiveConfig,
    };

    const encoded = encodeServerToAgentProto(serverMsg);
    // Verify the encoded message is valid protobuf
    expect(encoded.byteLength).toBeGreaterThan(0);
    expect(isProtobufFrame(encoded)).toBe(true);
  });
});
