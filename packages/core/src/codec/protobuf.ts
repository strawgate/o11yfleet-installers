// Protobuf codec for standard OpAMP wire format.
// Converts between our internal snake_case types and protobuf binary encoding.

import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import {
  AgentToServerSchema,
  ServerToAgentSchema,
  AgentConfigMapSchema,
  AgentConfigFileSchema,
  AgentRemoteConfigSchema,
  AgentIdentificationSchema,
  ServerErrorResponseSchema,
  RetryInfoSchema,
  ConnectionSettingsOffersSchema,
  OpAMPConnectionSettingsSchema,
  HeadersSchema,
  HeaderSchema,
  ServerToAgentCommandSchema,
  RemoteConfigStatuses as PbRemoteConfigStatuses,
  ServerErrorResponseType as PbServerErrorResponseType,
  CommandType as PbCommandType,
  ConnectionSettingsStatuses as PbConnectionSettingsStatuses,
  AgentDescriptionSchema,
  ComponentHealthSchema,
  EffectiveConfigSchema,
  AgentDisconnectSchema,
  RemoteConfigStatusSchema,
  AvailableComponentsSchema,
  ComponentDetailsSchema,
  ConnectionSettingsStatusSchema,
} from "./gen/opamp_pb.js";
import {
  KeyValueSchema,
  AnyValueSchema,
  ArrayValueSchema,
  KeyValueListSchema,
} from "./gen/anyvalue_pb.js";
import type {
  AgentToServer as PbAgentToServer,
  ServerToAgent as PbServerToAgent,
  AgentDescription as PbAgentDescription,
  ComponentHealth as PbComponentHealth,
  RemoteConfigStatus as PbRemoteConfigStatus,
  EffectiveConfig as PbEffectiveConfig,
  AgentDisconnect as PbAgentDisconnect,
  AvailableComponents as PbAvailableComponents,
  ComponentDetails as PbComponentDetails,
} from "./gen/opamp_pb.js";
import type { KeyValue as PbKeyValue, AnyValue as PbAnyValue } from "./gen/anyvalue_pb.js";
import type {
  AgentToServer,
  ServerToAgent,
  AgentDescription,
  ComponentHealth,
  RemoteConfigStatus,
  KeyValue,
  AnyValue,
} from "./types.js";
import {
  RemoteConfigStatuses,
  ServerErrorResponseType,
  CommandType,
  ConnectionSettingsStatuses,
} from "./types.js";

// ─── Decode: protobuf binary → internal types ─────────────────────

export function decodeAgentToServerProto(buf: ArrayBuffer): AgentToServer {
  // The opamp-go library prepends a single-byte header before the protobuf payload.
  // The header byte is the data type: 0 = protobuf AgentToServer message.
  // See: https://github.com/open-telemetry/opamp-go/blob/main/internal/wsmessage.go
  let data = new Uint8Array(buf);
  if (data.length > 1 && data[0] === 0x00) {
    // Strip the 0x00 data-type header
    data = data.subarray(1);
  }
  const pb = fromBinary(AgentToServerSchema, data);
  return pbAgentToServerToInternal(pb);
}

function pbAgentToServerToInternal(pb: PbAgentToServer): AgentToServer {
  const result: AgentToServer = {
    instance_uid: pb.instanceUid,
    sequence_num: Number(pb.sequenceNum),
    capabilities: Number(pb.capabilities),
    flags: Number(pb.flags),
  };

  if (pb.agentDescription) {
    result.agent_description = pbAgentDescToInternal(pb.agentDescription);
  }
  if (pb.health) {
    result.health = pbHealthToInternal(pb.health);
  }
  if (pb.effectiveConfig?.configMap) {
    result.effective_config = {
      config_map: {
        config_map: pbConfigMapToInternal(pb.effectiveConfig.configMap.configMap),
      },
    };
  }
  if (pb.remoteConfigStatus) {
    result.remote_config_status = pbRemoteConfigStatusToInternal(pb.remoteConfigStatus);
  }
  if (pb.agentDisconnect) {
    result.agent_disconnect = {};
  }
  if (pb.availableComponents) {
    result.available_components = pbAvailableComponentsToInternal(pb.availableComponents);
  }
  if (pb.connectionSettingsStatus) {
    const statusMap: Record<number, ConnectionSettingsStatuses> = {
      [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_UNSET]:
        ConnectionSettingsStatuses.UNSET,
      [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLIED]:
        ConnectionSettingsStatuses.APPLIED,
      [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLYING]:
        ConnectionSettingsStatuses.APPLYING,
      [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_FAILED]:
        ConnectionSettingsStatuses.FAILED,
    };
    result.connection_settings_status = {
      last_connection_settings_hash: pb.connectionSettingsStatus.lastConnectionSettingsHash,
      status: statusMap[pb.connectionSettingsStatus.status] ?? ConnectionSettingsStatuses.UNSET,
      // Don't coerce empty string to undefined. Same pattern as the
      // destination_endpoint / heartbeat_interval_seconds fixes —
      // an explicitly-empty string is valid and must round-trip.
      error_message: pb.connectionSettingsStatus.errorMessage,
    };
  }

  return result;
}

function pbCommandTypeToInternal(pbType: PbCommandType): CommandType {
  switch (pbType) {
    case PbCommandType.CommandType_Restart:
      return CommandType.Restart;
    default:
      throw new Error(`Unknown CommandType on wire: ${pbType}`);
  }
}

function pbAgentDescToInternal(pb: PbAgentDescription): AgentDescription {
  return {
    identifying_attributes: pb.identifyingAttributes.map(pbKvToInternal),
    non_identifying_attributes: pb.nonIdentifyingAttributes.map(pbKvToInternal),
  };
}

function pbComponentDetailsToInternal(pb: PbComponentDetails): Record<string, unknown> {
  const subMap: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(pb.subComponentMap)) {
    subMap[key] = pbComponentDetailsToInternal(val);
  }
  return {
    metadata: pb.metadata.map(pbKvToInternal),
    sub_component_map: subMap,
  };
}

function pbAvailableComponentsToInternal(pb: PbAvailableComponents): Record<string, unknown> {
  const components: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(pb.components)) {
    components[key] = pbComponentDetailsToInternal(val);
  }
  return {
    hash: pb.hash,
    components,
  };
}

function pbHealthToInternal(pb: PbComponentHealth): ComponentHealth {
  const healthMap: Record<string, ComponentHealth> = {};
  for (const [key, val] of Object.entries(pb.componentHealthMap)) {
    healthMap[key] = pbHealthToInternal(val);
  }
  return {
    healthy: pb.healthy,
    start_time_unix_nano: pb.startTimeUnixNano,
    last_error: pb.lastError,
    status: pb.status,
    status_time_unix_nano: pb.statusTimeUnixNano,
    component_health_map: healthMap,
  };
}

function pbRemoteConfigStatusToInternal(pb: PbRemoteConfigStatus): RemoteConfigStatus {
  const statusMap: Record<number, RemoteConfigStatuses> = {
    [PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET]: RemoteConfigStatuses.UNSET,
    [PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED]: RemoteConfigStatuses.APPLIED,
    [PbRemoteConfigStatuses.RemoteConfigStatuses_APPLYING]: RemoteConfigStatuses.APPLYING,
    [PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED]: RemoteConfigStatuses.FAILED,
  };
  return {
    last_remote_config_hash: pb.lastRemoteConfigHash,
    status: statusMap[pb.status] ?? RemoteConfigStatuses.UNSET,
    error_message: pb.errorMessage,
  };
}

function pbConfigMapToInternal(
  pb: Record<string, { body: Uint8Array; contentType: string }>,
): Record<string, { body: Uint8Array; content_type: string }> {
  const result: Record<string, { body: Uint8Array; content_type: string }> = {};
  for (const [key, val] of Object.entries(pb)) {
    result[key] = { body: val.body, content_type: val.contentType };
  }
  return result;
}

function pbKvToInternal(pb: PbKeyValue): KeyValue {
  return {
    key: pb.key,
    value: pbAnyValueToInternal(pb.value),
  };
}

function pbAnyValueToInternal(pb: PbAnyValue | undefined): AnyValue {
  if (!pb || pb.value.case === undefined) return {};
  switch (pb.value.case) {
    case "stringValue":
      return { string_value: pb.value.value };
    case "boolValue":
      return { bool_value: pb.value.value };
    case "intValue":
      return { int_value: pb.value.value };
    case "doubleValue":
      return { double_value: pb.value.value };
    case "bytesValue":
      return { bytes_value: pb.value.value };
    case "arrayValue":
      return { array_value: (pb.value.value.values ?? []).map(pbAnyValueToInternal) };
    case "kvlistValue":
      return { kvlist_value: (pb.value.value.values ?? []).map(pbKvToInternal) };
    default:
      return {};
  }
}

function internalAnyValueToPb(val: AnyValue | undefined): PbAnyValue | undefined {
  // Use explicit `=== undefined` rather than truthy `!val` so future
  // value types where `0` / `false` are valid don't collapse to absent.
  // Note that proto3 has no "present-but-empty" concept for oneof
  // fields, so an `{}` AnyValue (no case set) correctly maps to
  // undefined — this round-trips because decode returns `{}` for
  // absent. The fix is hygiene, not a semantic change.
  if (val === undefined) return undefined;
  if (val.string_value !== undefined) {
    return create(AnyValueSchema, {
      value: { case: "stringValue" as const, value: val.string_value },
    });
  }
  if (val.bool_value !== undefined) {
    return create(AnyValueSchema, { value: { case: "boolValue" as const, value: val.bool_value } });
  }
  if (val.int_value !== undefined) {
    return create(AnyValueSchema, { value: { case: "intValue" as const, value: val.int_value } });
  }
  if (val.double_value !== undefined) {
    return create(AnyValueSchema, {
      value: { case: "doubleValue" as const, value: val.double_value },
    });
  }
  if (val.bytes_value !== undefined) {
    return create(AnyValueSchema, {
      value: { case: "bytesValue" as const, value: val.bytes_value },
    });
  }
  if (val.array_value !== undefined) {
    return create(AnyValueSchema, {
      value: {
        case: "arrayValue" as const,
        value: create(ArrayValueSchema, {
          values: val.array_value.map(internalAnyValueToPb) as PbAnyValue[],
        }),
      },
    });
  }
  if (val.kvlist_value !== undefined) {
    return create(AnyValueSchema, {
      value: {
        case: "kvlistValue" as const,
        value: create(KeyValueListSchema, {
          values: val.kvlist_value.map((kv) =>
            create(KeyValueSchema, { key: kv.key, value: internalAnyValueToPb(kv.value) }),
          ),
        }),
      },
    });
  }
  return undefined;
}

function internalComponentDetailsToPb(detail: Record<string, unknown>): PbComponentDetails {
  const subMap: Record<string, PbComponentDetails> = {};
  const subRaw = (detail["sub_component_map"] ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(subRaw)) {
    subMap[key] = internalComponentDetailsToPb(val as Record<string, unknown>);
  }
  const metaRaw = (detail["metadata"] ?? []) as KeyValue[];
  return create(ComponentDetailsSchema, {
    metadata: metaRaw.map((kv) =>
      create(KeyValueSchema, { key: kv.key, value: internalAnyValueToPb(kv.value) }),
    ),
    subComponentMap: subMap,
  });
}

function internalAvailableComponentsToPb(ac: Record<string, unknown>): PbAvailableComponents {
  const components: Record<string, PbComponentDetails> = {};
  const raw = (ac["components"] ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(raw)) {
    components[key] = internalComponentDetailsToPb(val as Record<string, unknown>);
  }
  return create(AvailableComponentsSchema, {
    hash: (ac["hash"] as Uint8Array | undefined) ?? new Uint8Array(0),
    components,
  });
}

function internalComponentHealthToPb(health: ComponentHealth): PbComponentHealth {
  const childMap: Record<string, PbComponentHealth> = {};
  for (const [key, val] of Object.entries(health.component_health_map ?? {})) {
    childMap[key] = internalComponentHealthToPb(val);
  }
  return create(ComponentHealthSchema, {
    healthy: health.healthy,
    startTimeUnixNano: health.start_time_unix_nano,
    lastError: health.last_error,
    status: health.status,
    statusTimeUnixNano: health.status_time_unix_nano,
    componentHealthMap: childMap,
  });
}

// ─── Encode: internal types → protobuf binary ─────────────────────

export function encodeServerToAgentProto(msg: ServerToAgent): ArrayBuffer {
  const pb = internalToServerToAgentPb(msg);
  const payload = toBinary(ServerToAgentSchema, pb);
  // Prepend opamp-go data-type header byte (0x00 = protobuf).
  // See: https://github.com/open-telemetry/opamp-go/blob/main/internal/wsmessage.go
  const result = new Uint8Array(1 + payload.length);
  result[0] = 0x00;
  result.set(payload, 1);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

function internalToServerToAgentPb(msg: ServerToAgent): PbServerToAgent {
  const pb = create(ServerToAgentSchema, {
    instanceUid: msg.instance_uid,
    flags: BigInt(msg.flags),
    capabilities: BigInt(msg.capabilities),
  });

  // Don't drop 0 — a server can legitimately signal "stop heartbeating"
  // by sending heart_beat_interval = 0. The previous `> 0` guard
  // conflated "field absent" with "explicitly zero".
  if (msg.heart_beat_interval !== null && msg.heart_beat_interval !== undefined) {
    pb.heartBeatInterval = BigInt(msg.heart_beat_interval);
  }

  if (msg.agent_identification) {
    pb.agentIdentification = create(AgentIdentificationSchema, {
      newInstanceUid: msg.agent_identification.new_instance_uid,
    });
  }

  if (msg.remote_config) {
    const configMapEntries: Record<string, { body: Uint8Array; contentType: string }> = {};
    const srcMap = msg.remote_config.config?.config_map ?? {};
    for (const [key, val] of Object.entries(srcMap)) {
      configMapEntries[key] = create(AgentConfigFileSchema, {
        body: val.body,
        contentType: val.content_type,
      });
    }

    pb.remoteConfig = create(AgentRemoteConfigSchema, {
      config: create(AgentConfigMapSchema, {
        configMap: configMapEntries,
      }),
      configHash: msg.remote_config.config_hash,
    });
  }

  if (msg.error_response) {
    const typeMap: Record<number, PbServerErrorResponseType> = {
      [ServerErrorResponseType.Unknown]: PbServerErrorResponseType.ServerErrorResponseType_Unknown,
      [ServerErrorResponseType.BadRequest]:
        PbServerErrorResponseType.ServerErrorResponseType_BadRequest,
      [ServerErrorResponseType.Unavailable]:
        PbServerErrorResponseType.ServerErrorResponseType_Unavailable,
    };
    pb.errorResponse = create(ServerErrorResponseSchema, {
      type:
        typeMap[msg.error_response.type] ??
        PbServerErrorResponseType.ServerErrorResponseType_Unknown,
      errorMessage: msg.error_response.error_message,
    });
    if (msg.error_response.retry_info) {
      pb.errorResponse.retryInfo = create(RetryInfoSchema, {
        retryAfterNanoseconds: msg.error_response.retry_info.retry_after_nanoseconds,
      });
    }
  }

  if (msg.connection_settings) {
    const cs = create(ConnectionSettingsOffersSchema, {
      hash: msg.connection_settings.hash,
    });
    if (msg.connection_settings.opamp) {
      const opamp = create(OpAMPConnectionSettingsSchema, {});
      // Use explicit `!== undefined` so legitimate "" and 0 values
      // round-trip. Truthy guards conflate omission with default.
      if (msg.connection_settings.opamp.destination_endpoint !== undefined) {
        opamp.destinationEndpoint = msg.connection_settings.opamp.destination_endpoint;
      }
      if (msg.connection_settings.opamp.heartbeat_interval_seconds !== undefined) {
        opamp.heartbeatIntervalSeconds = BigInt(
          msg.connection_settings.opamp.heartbeat_interval_seconds,
        );
      }
      if (msg.connection_settings.opamp.headers?.length) {
        opamp.headers = create(HeadersSchema, {
          headers: msg.connection_settings.opamp.headers.map((h) =>
            create(HeaderSchema, { key: h.key, value: h.value }),
          ),
        });
      }
      cs.opamp = opamp;
    }
    pb.connectionSettings = cs;
  }

  if (msg.command) {
    const typeMap: Record<number, PbCommandType> = {
      [CommandType.Restart]: PbCommandType.CommandType_Restart,
    };
    const pbType = typeMap[msg.command.type];
    if (pbType === undefined) {
      // Fail fast on unknown command types so a new CommandType added to the
      // local enum but not mapped here surfaces as an explicit error rather
      // than silently sending a Restart command.
      throw new Error(`Unknown CommandType: ${msg.command.type}`);
    }
    pb.command = create(ServerToAgentCommandSchema, {
      type: pbType,
    });
  }

  return pb;
}

// ─── Agent→Server encode/decode (for fake-agent and tests) ────────

export function decodeServerToAgentProto(buf: ArrayBuffer): ServerToAgent {
  let data = new Uint8Array(buf);
  if (data.length > 0 && data[0] === 0x00) {
    data = data.subarray(1);
  }
  const pb = fromBinary(ServerToAgentSchema, data);
  return {
    instance_uid: pb.instanceUid,
    flags: Number(pb.flags),
    capabilities: Number(pb.capabilities),
    error_response: pb.errorResponse
      ? {
          type:
            pb.errorResponse.type === PbServerErrorResponseType.ServerErrorResponseType_BadRequest
              ? ServerErrorResponseType.BadRequest
              : pb.errorResponse.type ===
                  PbServerErrorResponseType.ServerErrorResponseType_Unavailable
                ? ServerErrorResponseType.Unavailable
                : ServerErrorResponseType.Unknown,
          error_message: pb.errorResponse.errorMessage ?? "",
          // Bug fix: retry_info was previously dropped on decode despite
          // being written by the encoder. Same shape as the
          // connection_settings bug — silent loss of the server's
          // backoff hint to the agent.
          retry_info: pb.errorResponse.retryInfo
            ? {
                retry_after_nanoseconds: pb.errorResponse.retryInfo.retryAfterNanoseconds,
              }
            : undefined,
        }
      : undefined,
    remote_config: pb.remoteConfig
      ? {
          config: {
            config_map: Object.fromEntries(
              Object.entries(pb.remoteConfig.config?.configMap ?? {}).map(([k, v]) => [
                k,
                {
                  body: v.body,
                  content_type: v.contentType,
                },
              ]),
            ),
          },
          config_hash: pb.remoteConfig.configHash,
        }
      : undefined,
    agent_identification: pb.agentIdentification
      ? { new_instance_uid: pb.agentIdentification.newInstanceUid }
      : undefined,
    // Decode server-driven Command (§5.9). Encoder writes this field for
    // restart commands; without round-trip the agent receives the frame
    // but `msg.command` is silently dropped, so tests/fake-agent see
    // every restart as a generic ServerToAgent with no actionable field.
    // Mirrors the encoder's contract: throw on unknown so a future
    // CommandType added upstream surfaces explicitly instead of silently
    // becoming Restart.
    command: pb.command ? { type: pbCommandTypeToInternal(pb.command.type) } : undefined,
    // proto3 doesn't distinguish field-absent from default-value, so
    // 0 round-trips as 0 (not undefined). Consumers that previously
    // relied on `undefined` for "absent" should treat 0 as "no
    // heartbeat" (the spec-defined meaning).
    heart_beat_interval: Number(pb.heartBeatInterval),
    // Bug fix: connection_settings was previously dropped on decode.
    // The encoder writes the field; the decoder must read it back, or
    // any code path that decodes a server frame (tests, fake-agent,
    // future routing logic) sees `undefined` even when a claim was
    // delivered. Property-test discovered: round-trip identity failed.
    connection_settings: pb.connectionSettings
      ? {
          hash: pb.connectionSettings.hash,
          opamp: pb.connectionSettings.opamp
            ? {
                // Round-trip "" and 0 faithfully. proto3 doesn't
                // distinguish field-absent from default-value, so we
                // can't tell "explicitly empty" from "not sent" on the
                // wire — but at least we don't *additionally* coerce
                // received-as-default to undefined here.
                destination_endpoint: pb.connectionSettings.opamp.destinationEndpoint,
                heartbeat_interval_seconds: Number(
                  pb.connectionSettings.opamp.heartbeatIntervalSeconds,
                ),
                headers: pb.connectionSettings.opamp.headers?.headers?.map((h) => ({
                  key: h.key,
                  value: h.value,
                })),
              }
            : undefined,
        }
      : undefined,
  };
}

export function encodeAgentToServerProto(msg: AgentToServer): ArrayBuffer {
  const pb = create(AgentToServerSchema, {
    instanceUid: msg.instance_uid,
    sequenceNum: BigInt(msg.sequence_num),
    capabilities: BigInt(msg.capabilities),
    flags: BigInt(msg.flags),
  });
  if (msg.agent_description) {
    pb.agentDescription = create(AgentDescriptionSchema, {
      identifyingAttributes: msg.agent_description.identifying_attributes.map((kv) =>
        create(KeyValueSchema, { key: kv.key, value: internalAnyValueToPb(kv.value) }),
      ),
      nonIdentifyingAttributes: msg.agent_description.non_identifying_attributes.map((kv) =>
        create(KeyValueSchema, { key: kv.key, value: internalAnyValueToPb(kv.value) }),
      ),
    });
  }
  if (msg.health) {
    pb.health = internalComponentHealthToPb(msg.health);
  }
  if (msg.effective_config) {
    const configMap: Record<string, { body: Uint8Array; contentType: string }> = {};
    for (const [key, val] of Object.entries(msg.effective_config.config_map?.config_map ?? {})) {
      configMap[key] = create(AgentConfigFileSchema, {
        body: val.body,
        contentType: val.content_type,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pb.effectiveConfig = create(EffectiveConfigSchema as any, {
      configMap: create(AgentConfigMapSchema, { configMap }),
    }) as unknown as PbEffectiveConfig;
  }
  if (msg.remote_config_status) {
    const statusMap: Record<number, PbRemoteConfigStatuses> = {
      [RemoteConfigStatuses.UNSET]: PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
      [RemoteConfigStatuses.APPLIED]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
      [RemoteConfigStatuses.APPLYING]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLYING,
      [RemoteConfigStatuses.FAILED]: PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pb.remoteConfigStatus = create(RemoteConfigStatusSchema as any, {
      lastRemoteConfigHash: msg.remote_config_status.last_remote_config_hash,
      status:
        statusMap[msg.remote_config_status.status] ??
        PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
      errorMessage: msg.remote_config_status.error_message,
    }) as unknown as PbRemoteConfigStatus;
  }
  if (msg.agent_disconnect) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pb.agentDisconnect = create(AgentDisconnectSchema as any, {}) as unknown as PbAgentDisconnect;
  }
  if (msg.available_components) {
    pb.availableComponents = internalAvailableComponentsToPb(msg.available_components);
  }
  if (msg.connection_settings_status) {
    // Encoder counterpart for the agent's acknowledgement of a server
    // ConnectionSettingsOffers (proto3 field 15). The decoder has read
    // this field for a long time; the encoder previously skipped it,
    // so any test or in-process caller round-tripping a message with
    // this field set silently lost it. Property-test
    // `codec.properties.test.ts` regression-guards the round-trip.
    const statusMap: Record<number, PbConnectionSettingsStatuses> = {
      [ConnectionSettingsStatuses.UNSET]:
        PbConnectionSettingsStatuses.ConnectionSettingsStatuses_UNSET,
      [ConnectionSettingsStatuses.APPLIED]:
        PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLIED,
      [ConnectionSettingsStatuses.APPLYING]:
        PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLYING,
      [ConnectionSettingsStatuses.FAILED]:
        PbConnectionSettingsStatuses.ConnectionSettingsStatuses_FAILED,
    };
    pb.connectionSettingsStatus = create(ConnectionSettingsStatusSchema, {
      lastConnectionSettingsHash: msg.connection_settings_status.last_connection_settings_hash,
      status:
        statusMap[msg.connection_settings_status.status] ??
        PbConnectionSettingsStatuses.ConnectionSettingsStatuses_UNSET,
      errorMessage: msg.connection_settings_status.error_message ?? "",
    });
  }
  const payload = toBinary(AgentToServerSchema, pb);
  const result = new Uint8Array(1 + payload.length);
  result[0] = 0x00;
  result.set(payload, 1);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

// ─── Format detection ─────────────────────────────────────────────

/**
 * Detect whether a binary WebSocket message is protobuf or our legacy JSON
 * framing. Production paths only emit protobuf today (JSON framing was
 * removed in commit c315fc1); this function exists for codec consumers
 * that still need to discriminate, and as a safety check on the wire.
 *
 * Three wire formats:
 *   1. JSON framing: [4-byte BE length N][N bytes of JSON starting with '{']
 *   2. opamp-go protobuf: [0x00 header][protobuf payload]
 *   3. Raw protobuf (no header): first byte is a field tag (≥ 0x08)
 *
 * Discriminator (cheapest first):
 *   - byte[0] ≠ 0x00 → raw protobuf. proto3 field tags start at 0x08.
 *   - byte[0] = 0x00, length < 5 → too short to be JSON-framed (header + '{}'
 *     minimum is 6 bytes), so opamp-go.
 *   - byte[0] = 0x00, length ≥ 5: parse bytes[0..3] as a 32-bit BE length.
 *     If `length + 4 == buf.byteLength` AND byte[4] == '{', it's JSON.
 *     Otherwise it's opamp-go protobuf — the alternative would require
 *     a coincidental match between an arbitrary 32-bit BE value derived
 *     from protobuf field tags + payload bytes and the actual buffer
 *     length, with byte[4] = '{' on top. Astronomically unlikely.
 *
 * History:
 *   - v1 used `byte[4] == '{'` as the JSON discriminator. False negative
 *     when byte[4] of a valid protobuf frame happened to be 0x7b (e.g.,
 *     `instance_uid[1] = 123`). Found by fast-check.
 *   - v2 used `byte[1] >= 0x08` as the JSON-vs-protobuf discriminator.
 *     False positive when JSON length ≥ 524288 (byte[1] of the BE length
 *     becomes ≥ 0x08). Caught by CodeRabbit review on PR #426.
 *   - v3 (this) uses the length-prefix-matches-buffer-size invariant.
 *     Both prior failure modes become impossible.
 */
export function isProtobufFrame(buf: ArrayBuffer): boolean {
  if (buf.byteLength === 0) return false;
  const bytes = new Uint8Array(buf);

  // Raw protobuf: first byte is a field tag, never 0x00 in valid proto3.
  if (bytes[0] !== 0x00) return true;

  // byte[0] == 0x00. Below 5 bytes, JSON framing is impossible (it needs
  // at least 4 length-prefix bytes plus an opening brace), so anything
  // that fits the opamp-go shape is protobuf.
  if (buf.byteLength < 5) return true;

  // Parse bytes[0..3] as a 4-byte BE length. If the length matches the
  // buffer (length + 4 = byteLength) AND byte[4] is '{' (the only valid
  // first character for a JSON object), classify as JSON. Otherwise
  // protobuf.
  const claimedJsonLength =
    ((bytes[0]! << 24) >>> 0) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  if (claimedJsonLength + 4 === buf.byteLength && bytes[4] === 0x7b) {
    return false;
  }
  return true;
}
