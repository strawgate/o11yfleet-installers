// o11yfleet event types — used by Config DO → Queue → Consumer

export interface FleetEvent {
  type: FleetEventType;
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  timestamp: number;
}

export enum FleetEventType {
  AGENT_CONNECTED = "agent_connected",
  AGENT_DISCONNECTED = "agent_disconnected",
  AGENT_HEALTH_CHANGED = "agent_health_changed",
  CONFIG_APPLIED = "config_applied",
  CONFIG_REJECTED = "config_rejected",
  AGENT_ENROLLED = "agent_enrolled",
  CONFIG_EFFECTIVE_REPORTED = "config_effective_reported",
}

export interface AgentConnectedEvent extends FleetEvent {
  type: FleetEventType.AGENT_CONNECTED;
}

export interface AgentDisconnectedEvent extends FleetEvent {
  type: FleetEventType.AGENT_DISCONNECTED;
  reason?: string;
}

export interface AgentHealthChangedEvent extends FleetEvent {
  type: FleetEventType.AGENT_HEALTH_CHANGED;
  healthy: boolean;
  status?: string;
  last_error?: string;
}

export interface ConfigAppliedEvent extends FleetEvent {
  type: FleetEventType.CONFIG_APPLIED;
  config_hash: string;
}

export interface ConfigRejectedEvent extends FleetEvent {
  type: FleetEventType.CONFIG_REJECTED;
  config_hash: string;
  error_message: string;
}

export interface AgentEnrolledEvent extends FleetEvent {
  type: FleetEventType.AGENT_ENROLLED;
  generation: number;
}

export interface ConfigEffectiveReportedEvent extends FleetEvent {
  type: FleetEventType.CONFIG_EFFECTIVE_REPORTED;
  effective_config_hash: string;
}

export type AnyFleetEvent =
  | AgentConnectedEvent
  | AgentDisconnectedEvent
  | AgentHealthChangedEvent
  | ConfigAppliedEvent
  | ConfigRejectedEvent
  | AgentEnrolledEvent
  | ConfigEffectiveReportedEvent;
