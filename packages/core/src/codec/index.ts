export {
  decodeAgentToServer,
  encodeServerToAgent,
  prepareBroadcastMessage,
  prepareBroadcastMessageWithMeta,
} from "./decoder.js";
export type { PrepareBroadcastMessageMeta } from "./decoder.js";
export {
  decodeAgentToServerProto,
  decodeAgentToServerMinimal,
  decodeServerToAgentProto,
  encodeAgentToServerProto,
  encodeServerToAgentProto,
  encodeServerToAgentMinimal,
  isProtobufFrame,
  classifyMessageKind,
  canUseMinimalEncode,
  safeEncodeServerToAgent,
  type MessageKind,
  OPT_FLAG_AGENT_DESCRIPTION,
  OPT_FLAG_HEALTH,
  OPT_FLAG_EFFECTIVE_CONFIG,
  OPT_FLAG_REMOTE_CONFIG_STATUS,
  OPT_FLAG_DISCONNECT,
  OPT_FLAG_AVAILABLE_COMPONENTS,
  OPT_FLAG_CONNECTION_SETTINGS_STATUS,
} from "./protobuf.js";
export type { MinimalDecodeResult } from "./protobuf.js";
// Aliases for backward compatibility with tests (JSON framing removed in c315fc1)
export {
  encodeAgentToServerProto as encodeFrame,
  decodeServerToAgentProto as decodeFrame,
} from "./protobuf.js";
export type { AgentToServer, ServerToAgent } from "./types.js";
export {
  AgentCapabilities,
  ServerCapabilities,
  AgentToServerFlags,
  ServerToAgentFlags,
  RemoteConfigStatuses,
  ServerErrorResponseType,
  CommandType,
  ConnectionSettingsStatuses,
} from "./types.js";
export { hasCapability } from "./capabilities.js";
export type {
  AgentDescription,
  ComponentHealth,
  EffectiveConfig,
  AgentConfigMap,
  AgentConfigFile,
  RemoteConfigStatus,
  AgentRemoteConfig,
  ServerErrorResponse,
  AgentIdentification,
  AgentDisconnect,
  ConnectionSettingsOffers,
  OpAMPConnectionSettings,
  TelemetryConnectionSettings,
  Header,
  ConnectionSettingsStatus,
  ServerToAgentCommand,
  KeyValue,
  AnyValue,
} from "./types.js";
