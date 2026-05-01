export interface WSAttachment {
  tenant_id: string;
  config_id: string;
  instance_uid: string;
  connected_at: number;
  is_enrollment?: boolean;
  /** Agent-reported capabilities bitmask (from last AgentToServer message). */
  capabilities?: number;
  /** Signed assignment claim to deliver via ConnectionSettingsOffers on first response. */
  pending_connection_settings?: string;
  /** True until the first processFrame completes — used to bump generation on reconnect. */
  is_first_message?: boolean;
}

/** Runtime validation for WS attachment deserialized from hibernation storage. */
export function parseAttachment(raw: unknown): WSAttachment | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj["tenant_id"] !== "string" ||
    typeof obj["config_id"] !== "string" ||
    typeof obj["instance_uid"] !== "string" ||
    typeof obj["connected_at"] !== "number"
  ) {
    return null;
  }
  let connected_at = obj["connected_at"];
  if (!Number.isFinite(connected_at) || connected_at < 0) {
    connected_at = Date.now();
  }
  return {
    tenant_id: obj["tenant_id"],
    config_id: obj["config_id"],
    instance_uid: obj["instance_uid"],
    connected_at,
    is_enrollment: typeof obj["is_enrollment"] === "boolean" ? obj["is_enrollment"] : undefined,
    capabilities: typeof obj["capabilities"] === "number" ? obj["capabilities"] : undefined,
    pending_connection_settings:
      typeof obj["pending_connection_settings"] === "string"
        ? obj["pending_connection_settings"]
        : undefined,
    is_first_message:
      typeof obj["is_first_message"] === "boolean" ? obj["is_first_message"] : undefined,
  };
}
