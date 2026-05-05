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
  TelemetryConnectionSettingsSchema,
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
  Header,
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

/**
 * Minimal decode for hot path - returns only core fields.
 * Skips full type conversion of optional fields.
 * Use this for heartbeats where you only need instance_uid, sequence_num, capabilities, flags.
 */
export interface MinimalDecodeResult {
  instance_uid: Uint8Array;
  sequence_num: number;
  capabilities: number;
  flags: number;
  has_optional: boolean; // true if message has optional fields (use full decode)
  opt_flags: number; // bitmask: bit0=description, bit1=health, bit2=config, bit3=status, bit4=disconnect, bit5=components, bit6=conn_settings
}

// Opt flag constants for routing decisions
export const OPT_FLAG_AGENT_DESCRIPTION = 1 << 0; // field 3
export const OPT_FLAG_HEALTH = 1 << 1; // field 5
export const OPT_FLAG_EFFECTIVE_CONFIG = 1 << 2; // field 6
export const OPT_FLAG_REMOTE_CONFIG_STATUS = 1 << 3; // field 7
export const OPT_FLAG_DISCONNECT = 1 << 4; // field 9
export const OPT_FLAG_AVAILABLE_COMPONENTS = 1 << 5; // field 14
export const OPT_FLAG_CONNECTION_SETTINGS_STATUS = 1 << 6; // field 15

/**
 * Classify a message based on its optional fields.
 * Used to determine if minimal decode is safe or which processing path to use.
 */
export type MessageKind =
  | "heartbeat" // No optional fields - pure heartbeat
  | "disconnect" // Only agent_disconnect - minimal decode is safe
  | "other"; // Has other optional fields - needs full decode

/**
 * Determine if a message can be safely handled with minimal decode.
 *
 * Safe for minimal decode when:
 * 1. No optional fields (pure heartbeat) - OR
 * 2. ONLY agent_disconnect field (disconnect message) - the disconnect
 *    message body is never read by the worker, we just check presence
 *
 * Unsafe - needs full decode:
 * - agent_description (needs to update agent metadata)
 * - health (needs to update agent status)
 * - effective_config (needs to detect config drift)
 * - remote_config_status (needs to process ack)
 * - available_components (needs to store component inventory)
 * - connection_settings_status (needs to process ack)
 */
export function classifyMessageKind(opt_flags: number): MessageKind {
  // No optional fields = pure heartbeat
  if (opt_flags === 0) return "heartbeat";

  // Only disconnect flag set = disconnect message (body never read)
  if (opt_flags === OPT_FLAG_DISCONNECT) return "disconnect";

  // Has other optional fields = needs full decode
  return "other";
}

/**
 * Read a protobuf varint from the buffer. Returns the value and new offset.
 * Handles multi-byte varints (values >= 128 require multiple bytes).
 *
 * Returns { value: -1, newOffset: -1 } if the varint is truncated
 * (buffer ends before the continuation bit is cleared) or if the value
 * would exceed the safe 32-bit range (5+ bytes).
 */
function readVarint(data: Uint8Array, offset: number): { value: number; newOffset: number } {
  let value = 0;
  let i = offset;
  let shift = 0;
  while (i < data.length) {
    const byte = data[i]!;
    value |= (byte & 0x7f) << shift;
    i++;
    if ((byte & 0x80) === 0) {
      return { value, newOffset: i };
    }
    shift += 7;
    // JS bitwise shifts are masked to 0–31. Reject varints that would
    // need a 5th byte (shift >= 28 after increment) to avoid silent
    // truncation on the 6th byte (shift = 35, masked to 3).
    if (shift >= 28) {
      return { value: -1, newOffset: -1 };
    }
  }
  // Truncated: reached end of buffer before varint completed
  return { value: -1, newOffset: -1 };
}

export function decodeAgentToServerMinimal(buf: ArrayBuffer): MinimalDecodeResult | null {
  let data = new Uint8Array(buf);
  if (data.length > 1 && data[0] === 0x00) {
    data = data.subarray(1);
  }

  // Fast path: manually parse just the header fields
  // Protobuf varint encoding: tags are (field_number << 3) | wire_type
  // Field 1 (instance_uid): tag = 0x0a (1 << 3 | 2 = length-delimited)
  // Field 2 (sequence_num): tag = 0x10 (2 << 3 | 0 = varint)
  // Field 3 (capabilities): tag = 0x18 (3 << 3 | 0 = varint)
  // Field 4 (flags): tag = 0x20 (4 << 3 | 0 = varint)

  let offset = 0;
  let instance_uid: Uint8Array | undefined;
  let sequence_num = 0;
  let capabilities = 0;
  let flags = 0;
  let has_optional = false;
  let opt_flags = 0;

  while (offset < data.length) {
    const { value: tag, newOffset: tagOff } = readVarint(data, offset);
    if (tagOff === -1) return null;
    offset = tagOff;
    const wire_type = tag & 0x07;
    const field_num = tag >> 3;

    switch (field_num) {
      case 1: // instance_uid
        if (wire_type === 2) {
          // length-delimited: read multi-byte varint length
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          instance_uid = data.subarray(newOff, newOff + len);
          offset = newOff + len;
        }
        break;
      case 2: // sequence_num
        if (wire_type === 0) {
          // varint
          const { value, newOffset } = readVarint(data, offset);
          if (newOffset === -1) return null;
          sequence_num = value;
          offset = newOffset;
        }
        break;
      case 4: // capabilities
        if (wire_type === 0) {
          const { value, newOffset } = readVarint(data, offset);
          if (newOffset === -1) return null;
          capabilities = value;
          offset = newOffset;
        }
        break;
      case 10: // flags
        if (wire_type === 0) {
          const { value, newOffset } = readVarint(data, offset);
          if (newOffset === -1) return null;
          flags = value;
          offset = newOffset;
        }
        break;
      case 3: // agent_description
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 1;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      case 5: // health
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 2;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      case 6: // effective_config
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 4;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      case 7: // remote_config_status
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 8;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      case 9: // agent_disconnect
        // Wire type 2 (length-delimited) for empty message AgentDisconnect {}
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 16;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        } else if (wire_type === 0) {
          has_optional = true;
          opt_flags |= 16;
        }
        break;
      case 14: // available_components
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 32;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      case 15: // connection_settings_status
        if (wire_type === 2) {
          has_optional = true;
          opt_flags |= 64;
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        }
        break;
      default:
        // Unknown field: conservatively treat as optional to force full decode
        has_optional = true;
        if (wire_type === 0) {
          // varint: read multi-byte
          const { newOffset } = readVarint(data, offset);
          if (newOffset === -1) return null;
          offset = newOffset;
        } else if (wire_type === 2) {
          // length-delimited: read multi-byte length
          const { value: len, newOffset: newOff } = readVarint(data, offset);
          if (newOff === -1 || newOff + len > data.length) return null;
          offset = newOff + len;
        } else if (wire_type === 5) {
          offset += 4;
        } else if (wire_type === 1) {
          offset += 8;
        }
        break;
    }
  }

  if (!instance_uid) return null;

  return { instance_uid, sequence_num, capabilities, flags, has_optional, opt_flags };
}

// ─── Minimal Encode: ServerToAgent for hot path ─────────────────────

/**
 * Minimal encoder for ServerToAgent (heartbeat response).
 * Manually encodes protobuf to avoid protobuf-ts overhead.
 *
 * Protobuf layout for heartbeat (16-byte UID, flags=0):
 *   [0] 0x00          - header byte (opamp-go format)
 *   [1] 0x0a          - field 1 tag (instance_uid, length-delimited)
 *   [2] 0x10          - length = 16
 *   [3-18] <uid>      - 16-byte instance UID
 *   [19] 0x38         - field 7 tag (capabilities, varint)
 *   [20] <caps>       - capabilities
 *   [21] 0x60         - field 12 tag (heart_beat_interval, varint)
 *   [22+] <interval>  - interval value
 *
 * Note: flags (field 6) is omitted when 0 to match protobuf-ts/prost behavior.
 */

export function encodeServerToAgentMinimal(
  instanceUid: Uint8Array,
  flags: number,
  capabilities: number,
  heartBeatIntervalNs: bigint,
): ArrayBuffer {
  const uidLen = instanceUid.length;

  // Fall back to dynamic allocation for unusual UID lengths
  if (uidLen !== 16 && uidLen !== 32) {
    return encodeServerToAgentMinimalDynamic(instanceUid, flags, capabilities, heartBeatIntervalNs);
  }

  // Calculate sizes
  const capsBytes = capabilities < 0x80 ? 1 : varintSize(capabilities);
  const intervalBytes = heartBeatIntervalNs < 0x80n ? 1 : varintSizeBigInt(heartBeatIntervalNs);

  // flags is optional - omit when 0 to match protobuf-ts/prost behavior
  // This makes output byte-for-byte identical to WASM encode
  const hasFlags = flags !== 0;
  const flagsBytes = hasFlags ? (flags < 0x80 ? 1 : varintSize(flags)) : 0;

  // Total: header(1) + uid_field(2 + uidLen) + [flags_field] + caps_field(1 + varint) + interval_field(1 + varint)
  const totalLen =
    1 + 2 + uidLen + (hasFlags ? 1 + flagsBytes : 0) + 1 + capsBytes + 1 + intervalBytes;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  // Header byte (opamp-go format)
  buf[offset++] = 0x00;

  // Field 1: instance_uid (tag 0x0a = field 1, wire type 2)
  buf[offset++] = 0x0a; // tag
  buf[offset++] = uidLen; // length
  buf.set(instanceUid, offset);
  offset += uidLen;

  // Field 6: flags (optional, omit when 0)
  if (hasFlags) {
    buf[offset++] = 0x30; // tag
    offset = writeVarint(buf, offset, flags);
  }

  // Field 7: capabilities (tag 0x38 = field 7, wire type 0)
  buf[offset++] = 0x38;
  offset = writeVarint(buf, offset, capabilities);

  // Field 12: heart_beat_interval (tag 0x60 = field 12, wire type 0)
  buf[offset++] = 0x60;
  offset = writeVarintBigInt(buf, offset, heartBeatIntervalNs);

  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

// ─── Encode Safety Guard ───────────────────────────────────────────────

/**
 * Check if a ServerToAgent message can be safely encoded with minimal encode.
 *
 * Minimal encode only supports these fields:
 *   - instance_uid
 *   - flags (optional, defaults to 0)
 *   - capabilities
 *   - heart_beat_interval
 *
 * If any of these fields are present, full encode is required:
 *   - error_response
 *   - remote_config
 *   - connection_settings
 *   - agent_identification
 *   - command
 */
export function canUseMinimalEncode(msg: ServerToAgent): boolean {
  return (
    !msg.error_response &&
    !msg.remote_config &&
    !msg.connection_settings &&
    !msg.agent_identification &&
    !msg.command
  );
}

/**
 * Safely encode a ServerToAgent message, using minimal encode when possible.
 *
 * This function determines whether to use the fast minimal encoder or the
 * full protobuf-ts encoder based on the message content.
 *
 * @returns ArrayBuffer encoded in opamp-go wire format
 */
export function safeEncodeServerToAgent(msg: ServerToAgent): ArrayBuffer {
  // Fall back to full encode if:
  // - Message has fields that minimal encode doesn't support, OR
  // - heart_beat_interval is null/undefined (coercing to 0 would change semantics
  //   from "not set" to "stop heartbeating" per OpAMP spec)
  if (
    !canUseMinimalEncode(msg) ||
    msg.heart_beat_interval === null ||
    msg.heart_beat_interval === undefined
  ) {
    return encodeServerToAgentProto(msg);
  }

  // Convert instance_uid to Uint8Array if needed
  const uid =
    msg.instance_uid instanceof Uint8Array ? msg.instance_uid : new Uint8Array(msg.instance_uid);

  return encodeServerToAgentMinimal(
    uid,
    msg.flags ?? 0,
    msg.capabilities ?? 0,
    BigInt(msg.heart_beat_interval),
  );
}

/**
 * Fallback dynamic encoder for unusual UID lengths.
 * Slower than template path but handles any UID size correctly.
 */
function encodeServerToAgentMinimalDynamic(
  instanceUid: Uint8Array,
  flags: number,
  capabilities: number,
  heartBeatIntervalNs: bigint,
): ArrayBuffer {
  const uidLen = instanceUid.length;
  const uidLenBytes = varintSize(uidLen);

  // flags is optional - omit when 0 to match protobuf-ts/prost behavior
  const hasFlags = flags !== 0;
  const flagsBytes = hasFlags ? varintSize(flags) : 0;
  const capsBytes = varintSize(capabilities);
  const intervalBytes = varintSizeBigInt(heartBeatIntervalNs);

  const totalLen =
    1 +
    (1 + uidLenBytes + uidLen) +
    (hasFlags ? 1 + flagsBytes : 0) +
    (1 + capsBytes) +
    (1 + intervalBytes);
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  buf[offset++] = 0x00;
  buf[offset++] = 0x0a;
  offset = writeVarint(buf, offset, uidLen);
  buf.set(instanceUid, offset);
  offset += uidLen;

  if (hasFlags) {
    buf[offset++] = 0x30;
    offset = writeVarint(buf, offset, flags);
  }

  buf[offset++] = 0x38;
  offset = writeVarint(buf, offset, capabilities);
  buf[offset++] = 0x60;
  offset = writeVarintBigInt(buf, offset, heartBeatIntervalNs);

  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

/**
 * Calculate the number of bytes needed to encode a number as varint.
 */
function varintSize(value: number): number {
  if (value < 0) {
    // Negative varints always use 10 bytes
    return 10;
  }
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x200000) return 3;
  if (value < 0x10000000) return 4;
  return 5;
}

/**
 * Calculate the number of bytes needed to encode a bigint as varint.
 */
function varintSizeBigInt(value: bigint): number {
  if (value < BigInt(0)) {
    return 10;
  }
  if (value < BigInt(0x80)) return 1;
  if (value < BigInt(0x4000)) return 2;
  if (value < BigInt(0x200000)) return 3;
  if (value < BigInt(0x10000000)) return 4;
  if (value < BigInt(0x800000000)) return 5;
  if (value < BigInt(0x40000000000)) return 6;
  if (value < BigInt(0x2000000000000)) return 7;
  if (value < BigInt(0x100000000000000)) return 8;
  return 9;
}

/**
 * Write a number as varint to the buffer. Returns new offset.
 */
function writeVarint(buf: Uint8Array, offset: number, value: number): number {
  if (value < 0) {
    // Handle negative numbers (zigzag encoding for sint32, direct for uint64)
    value = value >>> 0; // Treat as unsigned
  }
  while (value > 0x7f) {
    buf[offset++] = (value & 0x7f) | 0x80;
    value = value >>> 7;
  }
  buf[offset++] = value & 0x7f;
  return offset;
}

/**
 * Write a bigint as varint to the buffer. Returns new offset.
 */
function writeVarintBigInt(buf: Uint8Array, offset: number, value: bigint): number {
  if (value < BigInt(0)) {
    value = BigInt.asUintN(64, value); // Treat as unsigned
  }
  while (value > BigInt(0x7f)) {
    buf[offset++] = Number((value & BigInt(0x7f)) | BigInt(0x80));
    value = value >> BigInt(7);
  }
  buf[offset++] = Number(value & BigInt(0x7f));
  return offset;
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
    result.connection_settings_status = {
      last_connection_settings_hash: pb.connectionSettingsStatus.lastConnectionSettingsHash,
      status:
        CONN_SETTINGS_STATUS_DECODE_MAP[pb.connectionSettingsStatus.status] ??
        ConnectionSettingsStatuses.UNSET,
      // Don't coerce empty string to undefined. Same pattern as the
      // destination_endpoint / heartbeat_interval_seconds fixes —
      // an explicitly-empty string is valid and must round-trip.
      error_message: pb.connectionSettingsStatus.errorMessage,
    };
  }

  return result;
}

/**
 * Map a wire CommandType to our internal enum. Returns `null` for unknown
 * values rather than throwing — proto3 enums are *open*: unknown numeric
 * values are preserved on the wire and the spec requires implementations
 * to keep parsing the surrounding message. Throwing here would fail the
 * entire `ServerToAgent` decode just because a future server added a new
 * command type. The caller drops the `command` field instead, leaving
 * the rest of the message intact.
 */
function pbCommandTypeToInternal(pbType: PbCommandType): CommandType | null {
  switch (pbType) {
    case PbCommandType.CommandType_Restart:
      return CommandType.Restart;
    default:
      return null;
  }
}

function pbAgentDescToInternal(pb: PbAgentDescription): AgentDescription {
  return {
    identifying_attributes: pb.identifyingAttributes.map(pbKvToInternal),
    non_identifying_attributes: pb.nonIdentifyingAttributes.map(pbKvToInternal),
  };
}

function pbComponentDetailsToInternal(pb: PbComponentDetails): Record<string, unknown> {
  // Object.create(null) for user-controlled string-keyed maps: a component
  // name like "__proto__" or "constructor" assigned into a plain {} mutates
  // Object.prototype instead of becoming an own property, breaking the
  // round-trip and creating a prototype-pollution surface. Null-prototype
  // maps store any string as a regular own property.
  const subMap: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(pb.subComponentMap)) {
    subMap[key] = pbComponentDetailsToInternal(val);
  }
  return {
    metadata: pb.metadata.map(pbKvToInternal),
    sub_component_map: subMap,
  };
}

function pbAvailableComponentsToInternal(pb: PbAvailableComponents): Record<string, unknown> {
  const components: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(pb.components)) {
    components[key] = pbComponentDetailsToInternal(val);
  }
  return {
    hash: pb.hash,
    components,
  };
}

function pbHealthToInternal(pb: PbComponentHealth): ComponentHealth {
  const healthMap: Record<string, ComponentHealth> = Object.create(null);
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

// Hoisted to module scope to avoid allocating a new object on every decode/encode call.
const CONN_SETTINGS_STATUS_DECODE_MAP: Record<number, ConnectionSettingsStatuses> = {
  [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_UNSET]: ConnectionSettingsStatuses.UNSET,
  [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLIED]:
    ConnectionSettingsStatuses.APPLIED,
  [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLYING]:
    ConnectionSettingsStatuses.APPLYING,
  [PbConnectionSettingsStatuses.ConnectionSettingsStatuses_FAILED]:
    ConnectionSettingsStatuses.FAILED,
};

function pbRemoteConfigStatusToInternal(pb: PbRemoteConfigStatus): RemoteConfigStatus {
  return {
    last_remote_config_hash: pb.lastRemoteConfigHash,
    status: REMOTE_CONFIG_STATUS_DECODE_MAP[pb.status] ?? RemoteConfigStatuses.UNSET,
    error_message: pb.errorMessage,
  };
}

const REMOTE_CONFIG_STATUS_DECODE_MAP: Record<number, RemoteConfigStatuses> = {
  [PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET]: RemoteConfigStatuses.UNSET,
  [PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED]: RemoteConfigStatuses.APPLIED,
  [PbRemoteConfigStatuses.RemoteConfigStatuses_APPLYING]: RemoteConfigStatuses.APPLYING,
  [PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED]: RemoteConfigStatuses.FAILED,
};

const REMOTE_CONFIG_STATUS_ENCODE_MAP: Record<number, PbRemoteConfigStatuses> = {
  [RemoteConfigStatuses.UNSET]: PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
  [RemoteConfigStatuses.APPLIED]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLIED,
  [RemoteConfigStatuses.APPLYING]: PbRemoteConfigStatuses.RemoteConfigStatuses_APPLYING,
  [RemoteConfigStatuses.FAILED]: PbRemoteConfigStatuses.RemoteConfigStatuses_FAILED,
};

const CONN_SETTINGS_STATUS_ENCODE_MAP: Record<number, PbConnectionSettingsStatuses> = {
  [ConnectionSettingsStatuses.UNSET]: PbConnectionSettingsStatuses.ConnectionSettingsStatuses_UNSET,
  [ConnectionSettingsStatuses.APPLIED]:
    PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLIED,
  [ConnectionSettingsStatuses.APPLYING]:
    PbConnectionSettingsStatuses.ConnectionSettingsStatuses_APPLYING,
  [ConnectionSettingsStatuses.FAILED]:
    PbConnectionSettingsStatuses.ConnectionSettingsStatuses_FAILED,
};

function pbConfigMapToInternal(
  pb: Record<string, { body: Uint8Array; contentType: string }>,
): Record<string, { body: Uint8Array; content_type: string }> {
  const result: Record<string, { body: Uint8Array; content_type: string }> = Object.create(null);
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
  // Null-prototype map for the same reason as the decode path: a key like
  // "__proto__" must be stored as an own property, not as the object's
  // [[Prototype]] slot.
  const subMap: Record<string, PbComponentDetails> = Object.create(null);
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
  const components: Record<string, PbComponentDetails> = Object.create(null);
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
  // Object.create(null): same prototype-pollution defense as the decoder
  // side. A user-supplied component_health_map keyed by "__proto__" would
  // otherwise mutate Object.prototype on assignment.
  const childMap: Record<string, PbComponentHealth> = Object.create(null);
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

function internalTelemetrySettingsToPb(settings: {
  destination_endpoint?: string;
  headers?: Header[];
  heartbeat_interval_seconds?: number;
}) {
  const pb = create(TelemetryConnectionSettingsSchema, {});
  if (settings.destination_endpoint !== undefined) {
    pb.destinationEndpoint = settings.destination_endpoint;
  }
  if (settings.heartbeat_interval_seconds !== undefined) {
    pb.heartbeatIntervalSeconds = BigInt(settings.heartbeat_interval_seconds);
  }
  if (settings.headers?.length) {
    pb.headers = create(HeadersSchema, {
      headers: settings.headers.map((h) => create(HeaderSchema, { key: h.key, value: h.value })),
    });
  }
  return pb;
}

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
    if (msg.connection_settings.own_metrics) {
      cs.ownMetrics = internalTelemetrySettingsToPb(msg.connection_settings.own_metrics);
    }
    if (msg.connection_settings.own_traces) {
      cs.ownTraces = internalTelemetrySettingsToPb(msg.connection_settings.own_traces);
    }
    if (msg.connection_settings.own_logs) {
      cs.ownLogs = internalTelemetrySettingsToPb(msg.connection_settings.own_logs);
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
    // For unknown CommandType values, `pbCommandTypeToInternal` returns
    // null and we drop the field — preserving proto3's open-enum
    // contract (unknown values must not fail the surrounding message).
    command: (() => {
      if (!pb.command) return undefined;
      const type = pbCommandTypeToInternal(pb.command.type);
      return type === null ? undefined : { type };
    })(),
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
          own_metrics: pb.connectionSettings.ownMetrics
            ? {
                destination_endpoint: pb.connectionSettings.ownMetrics.destinationEndpoint,
                heartbeat_interval_seconds: Number(
                  pb.connectionSettings.ownMetrics.heartbeatIntervalSeconds,
                ),
                headers: pb.connectionSettings.ownMetrics.headers?.headers?.map((h) => ({
                  key: h.key,
                  value: h.value,
                })),
              }
            : undefined,
          own_traces: pb.connectionSettings.ownTraces
            ? {
                destination_endpoint: pb.connectionSettings.ownTraces.destinationEndpoint,
                heartbeat_interval_seconds: Number(
                  pb.connectionSettings.ownTraces.heartbeatIntervalSeconds,
                ),
                headers: pb.connectionSettings.ownTraces.headers?.headers?.map((h) => ({
                  key: h.key,
                  value: h.value,
                })),
              }
            : undefined,
          own_logs: pb.connectionSettings.ownLogs
            ? {
                destination_endpoint: pb.connectionSettings.ownLogs.destinationEndpoint,
                heartbeat_interval_seconds: Number(
                  pb.connectionSettings.ownLogs.heartbeatIntervalSeconds,
                ),
                headers: pb.connectionSettings.ownLogs.headers?.headers?.map((h) => ({
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
    pb.effectiveConfig = create(EffectiveConfigSchema, {
      configMap: create(AgentConfigMapSchema, { configMap }),
    });
  }
  if (msg.remote_config_status) {
    pb.remoteConfigStatus = create(RemoteConfigStatusSchema, {
      lastRemoteConfigHash: msg.remote_config_status.last_remote_config_hash,
      status:
        REMOTE_CONFIG_STATUS_ENCODE_MAP[msg.remote_config_status.status] ??
        PbRemoteConfigStatuses.RemoteConfigStatuses_UNSET,
      errorMessage: msg.remote_config_status.error_message,
    });
  }
  if (msg.agent_disconnect) {
    pb.agentDisconnect = create(AgentDisconnectSchema, {});
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
    pb.connectionSettingsStatus = create(ConnectionSettingsStatusSchema, {
      lastConnectionSettingsHash: msg.connection_settings_status.last_connection_settings_hash,
      status:
        CONN_SETTINGS_STATUS_ENCODE_MAP[msg.connection_settings_status.status] ??
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
