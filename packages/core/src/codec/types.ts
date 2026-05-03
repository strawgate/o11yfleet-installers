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
  connection_settings_status?: ConnectionSettingsStatus;
  /**
   * Agent-reported available components (OpAMP spec field 14, "Development").
   * Wire-compatible with otelcol-contrib's opamp-go-encoded representation
   * (`AvailableComponents` / `ComponentDetails` proto messages). The internal
   * type stays loose (`Record<string, unknown>`) because the OpAMP spec
   * marks this field as Development and we don't want consumers depending
   * on a typed shape that may shift before reaching Beta.
   */
  available_components?: Record<string, unknown>;
}

export interface ServerToAgent {
  instance_uid: Uint8Array;
  error_response?: ServerErrorResponse;
  remote_config?: AgentRemoteConfig;
  connection_settings?: ConnectionSettingsOffers;
  flags: number;
  capabilities: number;
  agent_identification?: AgentIdentification;
  command?: ServerToAgentCommand;
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

// ─── Connection Settings ─────────────────────────────────────────────────────

export interface ConnectionSettingsOffers {
  hash: Uint8Array;
  opamp?: OpAMPConnectionSettings;
  /** Collector self-metrics export target (OpAMP own_metrics). */
  own_metrics?: TelemetryConnectionSettings;
  /** Collector self-traces export target (OpAMP own_traces). */
  own_traces?: TelemetryConnectionSettings;
  /** Collector self-logs export target (OpAMP own_logs). */
  own_logs?: TelemetryConnectionSettings;
}

/** Settings for collector self-telemetry (metrics/traces/logs) export. */
export interface TelemetryConnectionSettings {
  destination_endpoint?: string;
  headers?: Header[];
  heartbeat_interval_seconds?: number;
}

export interface OpAMPConnectionSettings {
  destination_endpoint?: string;
  headers?: Header[];
  heartbeat_interval_seconds?: number;
}

export interface Header {
  key: string;
  value: string;
}

export interface ConnectionSettingsStatus {
  last_connection_settings_hash: Uint8Array;
  status: ConnectionSettingsStatuses;
  error_message?: string;
}

export enum ConnectionSettingsStatuses {
  UNSET = 0,
  APPLIED = 1,
  APPLYING = 2,
  FAILED = 3,
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface ServerToAgentCommand {
  type: CommandType;
}

export enum CommandType {
  Restart = 0,
}

// ─── Key/Value ───────────────────────────────────────────────────────────────

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

// ─── Capability bit flags ────────────────────────────────────────────────────

export enum AgentCapabilities {
  Unspecified = 0,
  ReportsStatus = 0x00000001,
  AcceptsRemoteConfig = 0x00000002,
  ReportsEffectiveConfig = 0x00000004,
  AcceptsPackages = 0x00000008,
  ReportsPackageStatuses = 0x00000010,
  ReportsOwnTraces = 0x00000020,
  ReportsOwnMetrics = 0x00000040,
  ReportsOwnLogs = 0x00000080,
  AcceptsOpAMPConnectionSettings = 0x00000100,
  AcceptsOtherConnectionSettings = 0x00000200,
  AcceptsRestartCommand = 0x00000400,
  ReportsHealth = 0x00000800,
  ReportsRemoteConfig = 0x00001000,
  ReportsHeartbeat = 0x00002000,
  /** OpAMP §5.2.2 (Development). Agent reports its compiled-in components. */
  ReportsAvailableComponents = 0x00004000,
}

export enum ServerCapabilities {
  Unspecified = 0,
  AcceptsStatus = 0x00000001,
  OffersRemoteConfig = 0x00000002,
  AcceptsEffectiveConfig = 0x00000004,
  OffersConnectionSettings = 0x00000020,
}

export enum AgentToServerFlags {
  Unspecified = 0,
  RequestInstanceUid = 0x00000001,
  /** Indicates this message is a full state report (hello / reconnect). */
  FullState = 0x00000002,
}

export enum ServerToAgentFlags {
  Unspecified = 0,
  ReportFullState = 0x00000001,
}
