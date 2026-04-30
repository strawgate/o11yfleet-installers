// o11yfleet event types — used by Config DO → Queue → Consumer

export interface FleetEvent {
  type: FleetEventType;
  event_id: string;
  dedupe_key: string;
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  timestamp: number;
}

interface FleetEventIdentityInput {
  type: FleetEventType;
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  timestamp?: number;
  dedupe_key?: string;
}

type FleetEventInput<T extends FleetEventType, Extra extends object> = FleetEventIdentityInput &
  Extra & {
    type: T;
  };

export function makeFleetEvent<T extends FleetEventType, Extra extends object = object>(
  input: FleetEventInput<T, Extra>,
): FleetEvent & { type: T } & Extra {
  const timestamp = input.timestamp ?? Date.now();
  const eventId = crypto.randomUUID();
  const extraFields = input as Record<string, unknown>;
  const defaultDedupeParts = [
    input.type,
    input.tenant_id,
    input.config_id,
    input.instance_uid,
    extraFields["reason"],
    extraFields["generation"],
    extraFields["config_hash"],
    extraFields["effective_config_hash"],
    extraFields["status"],
    timestamp,
  ].filter((part): part is string | number | boolean => {
    return typeof part === "string" || typeof part === "number" || typeof part === "boolean";
  });
  // Prefer caller-supplied transition keys when the event has a domain sequence,
  // config hash, or connection generation. The timestamp fallback is only for
  // event types that do not yet expose a stronger deterministic transition id.
  // Empty strings are treated as "not supplied" so downstream consumers always
  // see a non-empty dedupe_key.
  const dedupeKey =
    typeof input.dedupe_key === "string" && input.dedupe_key.length > 0
      ? input.dedupe_key
      : defaultDedupeParts.join(":");

  return {
    ...input,
    timestamp,
    event_id: eventId,
    dedupe_key: dedupeKey,
  };
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
