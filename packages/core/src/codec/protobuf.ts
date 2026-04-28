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
  RemoteConfigStatuses as PbRemoteConfigStatuses,
  ServerErrorResponseType as PbServerErrorResponseType,
} from "./gen/opamp_pb.js";
import type {
  AgentToServer as PbAgentToServer,
  ServerToAgent as PbServerToAgent,
  AgentDescription as PbAgentDescription,
  ComponentHealth as PbComponentHealth,
  RemoteConfigStatus as PbRemoteConfigStatus,
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
import { RemoteConfigStatuses, ServerErrorResponseType } from "./types.js";

// ─── Decode: protobuf binary → internal types ─────────────────────

export function decodeAgentToServerProto(buf: ArrayBuffer): AgentToServer {
  const pb = fromBinary(AgentToServerSchema, new Uint8Array(buf));
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

  return result;
}

function pbAgentDescToInternal(pb: PbAgentDescription): AgentDescription {
  return {
    identifying_attributes: pb.identifyingAttributes.map(pbKvToInternal),
    non_identifying_attributes: pb.nonIdentifyingAttributes.map(pbKvToInternal),
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

// ─── Encode: internal types → protobuf binary ─────────────────────

export function encodeServerToAgentProto(msg: ServerToAgent): ArrayBuffer {
  const pb = internalToServerToAgentPb(msg);
  const bytes = toBinary(ServerToAgentSchema, pb);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function internalToServerToAgentPb(msg: ServerToAgent): PbServerToAgent {
  const pb = create(ServerToAgentSchema, {
    instanceUid: msg.instance_uid,
    flags: BigInt(msg.flags),
    capabilities: BigInt(msg.capabilities),
  });

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

  return pb;
}

// ─── Format detection ─────────────────────────────────────────────

/**
 * Detect whether a binary WebSocket message is protobuf or our custom JSON format.
 *
 * Our JSON format uses a 4-byte big-endian length prefix. For any payload under 16MB
 * the first byte is always 0x00. Standard protobuf never starts with 0x00 because
 * the first byte is a field tag (minimum 0x08 for field 1, varint type).
 */
export function isProtobufFrame(buf: ArrayBuffer): boolean {
  if (buf.byteLength === 0) return false;
  const first = new Uint8Array(buf)[0];
  return first !== 0x00;
}
