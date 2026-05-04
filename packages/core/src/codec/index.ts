export {
  decodeAgentToServer,
  encodeServerToAgent,
  prepareBroadcastMessage,
  prepareBroadcastMessageWithMeta,
} from "./decoder.js";
export type { PrepareBroadcastMessageMeta } from "./decoder.js";
export {
  decodeAgentToServerProto,
  decodeServerToAgentProto,
  encodeAgentToServerProto,
  encodeServerToAgentProto,
  isProtobufFrame,
} from "./protobuf.js";
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
