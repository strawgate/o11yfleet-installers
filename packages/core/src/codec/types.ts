// OpAMP framing types — subset of the proto for our use

export interface AgentToServer {
  instance_uid: Uint8Array;
  sequence_num: number;
  agent_description?: AgentDescription;
  capabilities: number;
  health?: ComponentHealth;
  effective_config?: EffectiveConfig;
  remote_config_status?: RemoteConfigStatus;
  agent_disconnect?: AgentDisconnect;
  flags: number;
}

export interface ServerToAgent {
  instance_uid: Uint8Array;
  error_response?: ServerErrorResponse;
  remote_config?: AgentRemoteConfig;
  flags: number;
  capabilities: number;
  agent_identification?: AgentIdentification;
  /** Recommended heartbeat interval in nanoseconds (OpAMP spec field 12). */
  heart_beat_interval?: number;
}

export interface AgentDescription {
  identifying_attributes: KeyValue[];
  non_identifying_attributes: KeyValue[];
}

export interface ComponentHealth {
  healthy: boolean;
  start_time_unix_nano: bigint;
  last_error: string;
  status: string;
  status_time_unix_nano: bigint;
  component_health_map: Record<string, ComponentHealth>;
}

export interface EffectiveConfig {
  config_map: AgentConfigMap;
}

export interface AgentConfigMap {
  config_map: Record<string, AgentConfigFile>;
}

export interface AgentConfigFile {
  body: Uint8Array;
  content_type: string;
}

export interface RemoteConfigStatus {
  last_remote_config_hash: Uint8Array;
  status: RemoteConfigStatuses;
  error_message: string;
}

export enum RemoteConfigStatuses {
  UNSET = 0,
  APPLIED = 1,
  APPLYING = 2,
  FAILED = 3,
}

export interface AgentRemoteConfig {
  config: AgentConfigMap;
  config_hash: Uint8Array;
}

export interface ServerErrorResponse {
  type: ServerErrorResponseType;
  error_message: string;
  retry_info?: RetryInfo;
}

export enum ServerErrorResponseType {
  Unknown = 0,
  BadRequest = 1,
  Unavailable = 2,
}

export interface RetryInfo {
  retry_after_nanoseconds: bigint;
}

export interface AgentIdentification {
  new_instance_uid: Uint8Array;
}

// oxlint-disable-next-line typescript/no-empty-object-type
export interface AgentDisconnect {}

export interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface AnyValue {
  string_value?: string;
  bool_value?: boolean;
  int_value?: bigint;
  double_value?: number;
  bytes_value?: Uint8Array;
  array_value?: AnyValue[];
  kvlist_value?: KeyValue[];
}

// Capability bit flags
export enum AgentCapabilities {
  Unspecified = 0,
  ReportsStatus = 0x00000001,
  AcceptsRemoteConfig = 0x00000002,
  ReportsEffectiveConfig = 0x00000004,
  ReportsHealth = 0x00000800,
  ReportsRemoteConfig = 0x00001000,
  ReportsHeartbeat = 0x00002000,
}

export enum ServerCapabilities {
  Unspecified = 0,
  AcceptsStatus = 0x00000001,
  OffersRemoteConfig = 0x00000002,
  AcceptsEffectiveConfig = 0x00000004,
}

export enum AgentToServerFlags {
  Unspecified = 0,
  RequestInstanceUid = 0x00000001,
}

export enum ServerToAgentFlags {
  Unspecified = 0,
  ReportFullState = 0x00000001,
}
